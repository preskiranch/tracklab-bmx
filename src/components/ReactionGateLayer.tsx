import { useCallback, useEffect, useRef } from 'react';
import {
  projectReactionGateQuad,
  projectReactionGateWorldPoint,
  projectReactionGateWorldPointHomogeneous,
  reactionGateWorldQuad,
  REACTION_GATE_FLUSH_QUAD,
  REACTION_GATE_SOURCE_QUAD,
  REACTION_GATE_WORLD_WIDTH,
  type ReactionGatePoint,
  type ReactionGateWorldPoint,
} from '../lib/reactionGateGeometry';

export {
  projectReactionGateQuad,
  REACTION_GATE_FLUSH_QUAD,
  REACTION_GATE_SOURCE_QUAD,
  reactionGateWorldQuad,
} from '../lib/reactionGateGeometry';

const SCENE_WIDTH = 1672;
const SCENE_HEIGHT = 941;
export const REACTION_GATE_DROP_MS = 260;

function drawTexturedTriangle(
  context: CanvasRenderingContext2D,
  source: HTMLImageElement,
  sourcePoints: [ReactionGatePoint, ReactionGatePoint, ReactionGatePoint],
  destinationPoints: [ReactionGatePoint, ReactionGatePoint, ReactionGatePoint],
) {
  const [sourceOrigin, sourceX, sourceY] = sourcePoints;
  const [destinationOrigin, destinationX, destinationY] = destinationPoints;
  const sourceXX = sourceX.x - sourceOrigin.x;
  const sourceXY = sourceX.y - sourceOrigin.y;
  const sourceYX = sourceY.x - sourceOrigin.x;
  const sourceYY = sourceY.y - sourceOrigin.y;
  const determinant = (sourceXX * sourceYY) - (sourceYX * sourceXY);
  if (Math.abs(determinant) < 0.000001) return;

  const destinationXX = destinationX.x - destinationOrigin.x;
  const destinationXY = destinationX.y - destinationOrigin.y;
  const destinationYX = destinationY.x - destinationOrigin.x;
  const destinationYY = destinationY.y - destinationOrigin.y;
  const a = ((destinationXX * sourceYY) - (destinationYX * sourceXY)) / determinant;
  const b = ((destinationXY * sourceYY) - (destinationYY * sourceXY)) / determinant;
  const c = ((destinationYX * sourceXX) - (destinationXX * sourceYX)) / determinant;
  const d = ((destinationYY * sourceXX) - (destinationXY * sourceYX)) / determinant;
  const e = destinationOrigin.x - (a * sourceOrigin.x) - (c * sourceOrigin.y);
  const f = destinationOrigin.y - (b * sourceOrigin.x) - (d * sourceOrigin.y);
  const minX = Math.max(0, Math.floor(Math.min(...sourcePoints.map(({ x }) => x))) - 1);
  const minY = Math.max(0, Math.floor(Math.min(...sourcePoints.map(({ y }) => y))) - 1);
  const maxX = Math.min(source.naturalWidth, Math.ceil(Math.max(...sourcePoints.map(({ x }) => x))) + 1);
  const maxY = Math.min(source.naturalHeight, Math.ceil(Math.max(...sourcePoints.map(({ y }) => y))) + 1);

  context.save();
  context.beginPath();
  context.moveTo(destinationOrigin.x, destinationOrigin.y);
  context.lineTo(destinationX.x, destinationX.y);
  context.lineTo(destinationY.x, destinationY.y);
  context.closePath();
  context.clip();
  context.setTransform(a, b, c, d, e, f);
  context.drawImage(source, minX, minY, maxX - minX, maxY - minY, minX, minY, maxX - minX, maxY - minY);
  context.restore();
}

function gateWorldPoint(acrossRatio: number, depthRatio: number, progress: number): ReactionGateWorldPoint {
  const angle = Math.min(1, Math.max(0, progress)) * (Math.PI / 2);
  return {
    across: acrossRatio * REACTION_GATE_WORLD_WIDTH,
    upright: depthRatio * Math.cos(angle),
    downhill: depthRatio * Math.sin(angle),
  };
}

function drawGateFallback(
  context: CanvasRenderingContext2D,
  source: HTMLImageElement,
  progress: number,
) {
  context.clearRect(0, 0, SCENE_WIDTH, SCENE_HEIGHT);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';

  const destination = projectReactionGateQuad(progress);
  context.save();
  context.beginPath();
  context.moveTo(destination[0].x, destination[0].y);
  context.lineTo(destination[1].x, destination[1].y);
  context.lineTo(destination[2].x, destination[2].y);
  context.lineTo(destination[3].x, destination[3].y);
  context.closePath();
  context.clip();

  // WebGL is available in every supported WKWebView. This subdivided fallback
  // retains the same projective world model for defensive browser coverage.
  // No endpoint is interpolated independently, so the leaf cannot twist.
  const acrossSteps = 16;
  const depthSteps = 6;
  for (let acrossIndex = 0; acrossIndex < acrossSteps; acrossIndex += 1) {
    for (let depthIndex = 0; depthIndex < depthSteps; depthIndex += 1) {
      const across0 = acrossIndex / acrossSteps;
      const across1 = (acrossIndex + 1) / acrossSteps;
      const depth0 = depthIndex / depthSteps;
      const depth1 = (depthIndex + 1) / depthSteps;
      const world00 = gateWorldPoint(across0, depth0, progress);
      const world10 = gateWorldPoint(across1, depth0, progress);
      const world11 = gateWorldPoint(across1, depth1, progress);
      const world01 = gateWorldPoint(across0, depth1, progress);
      const source00 = projectReactionGateWorldPoint(gateWorldPoint(across0, depth0, 0));
      const source10 = projectReactionGateWorldPoint(gateWorldPoint(across1, depth0, 0));
      const source11 = projectReactionGateWorldPoint(gateWorldPoint(across1, depth1, 0));
      const source01 = projectReactionGateWorldPoint(gateWorldPoint(across0, depth1, 0));
      const destination00 = projectReactionGateWorldPoint(world00);
      const destination10 = projectReactionGateWorldPoint(world10);
      const destination11 = projectReactionGateWorldPoint(world11);
      const destination01 = projectReactionGateWorldPoint(world01);
      drawTexturedTriangle(
        context,
        source,
        [source00, source10, source11],
        [destination00, destination10, destination11],
      );
      drawTexturedTriangle(
        context,
        source,
        [source00, source11, source01],
        [destination00, destination11, destination01],
      );
    }
  }
  context.restore();
}

type GateProjectionRenderer = {
  buffer: WebGLBuffer;
  destinationLocation: number;
  gl: WebGLRenderingContext;
  program: WebGLProgram;
  sourceLocation: number;
  sourceSizeLocation: WebGLUniformLocation;
  texture: WebGLTexture;
  textureSource: string | null;
};

function createShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Unable to allocate Reaction Test gate shader.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? 'Unknown shader error';
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function createGateProjectionRenderer(canvas: HTMLCanvasElement): GateProjectionRenderer | null {
  const gl = canvas.getContext('webgl', {
    alpha: true,
    antialias: true,
    premultipliedAlpha: true,
    preserveDrawingBuffer: true,
  });
  if (!gl) return null;

  try {
    const vertexShader = createShader(gl, gl.VERTEX_SHADER, `
      attribute vec3 a_destination;
      attribute vec3 a_source;
      varying highp vec3 v_source;
      void main() {
        float clipX = ((2.0 * a_destination.x) / ${SCENE_WIDTH.toFixed(1)}) - a_destination.z;
        float clipY = a_destination.z - ((2.0 * a_destination.y) / ${SCENE_HEIGHT.toFixed(1)});
        gl_Position = vec4(clipX, clipY, 0.0, a_destination.z);
        v_source = a_source;
      }
    `);
    const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, `
      precision highp float;
      varying highp vec3 v_source;
      uniform sampler2D u_texture;
      uniform vec2 u_source_size;
      void main() {
        vec2 sourcePixel = v_source.xy / v_source.z;
        vec2 uv = vec2(sourcePixel.x / u_source_size.x, 1.0 - (sourcePixel.y / u_source_size.y));
        gl_FragColor = texture2D(u_texture, uv);
      }
    `);
    const program = gl.createProgram();
    if (!program) throw new Error('Unable to allocate Reaction Test gate program.');
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) ?? 'Unable to link Reaction Test gate program.');
    }
    const buffer = gl.createBuffer();
    const texture = gl.createTexture();
    const sourceSizeLocation = gl.getUniformLocation(program, 'u_source_size');
    if (!buffer || !texture || !sourceSizeLocation) {
      throw new Error('Unable to allocate Reaction Test gate projection resources.');
    }
    const destinationLocation = gl.getAttribLocation(program, 'a_destination');
    const sourceLocation = gl.getAttribLocation(program, 'a_source');
    if (destinationLocation < 0 || sourceLocation < 0) {
      throw new Error('Reaction Test gate projection attributes are unavailable.');
    }
    return {
      buffer,
      destinationLocation,
      gl,
      program,
      sourceLocation,
      sourceSizeLocation,
      texture,
      textureSource: null,
    };
  } catch {
    return null;
  }
}

function drawGateProjectively(
  renderer: GateProjectionRenderer,
  source: HTMLImageElement,
  progress: number,
) {
  const { gl } = renderer;
  if (gl.isContextLost()) return false;
  // Do not let an unrelated, already-consumed WebGL error misclassify this
  // frame. Bound the drain defensively so a broken driver cannot spin here.
  for (let errorIndex = 0; errorIndex < 8; errorIndex += 1) {
    if (gl.getError() === gl.NO_ERROR) break;
  }
  const sourceWorld = reactionGateWorldQuad(0);
  const destinationWorld = reactionGateWorldQuad(progress);
  const indices = [0, 1, 2, 0, 2, 3];
  const vertices = new Float32Array(indices.flatMap((index) => {
    const destination = projectReactionGateWorldPointHomogeneous(destinationWorld[index]);
    const sourceProjection = projectReactionGateWorldPointHomogeneous(sourceWorld[index]);
    return [
      destination.x,
      destination.y,
      destination.w,
      sourceProjection.x,
      sourceProjection.y,
      sourceProjection.w,
    ];
  }));

  gl.viewport(0, 0, SCENE_WIDTH, SCENE_HEIGHT);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.disable(gl.BLEND);
  gl.disable(gl.CULL_FACE);
  gl.disable(gl.DEPTH_TEST);
  gl.useProgram(renderer.program);
  gl.bindBuffer(gl.ARRAY_BUFFER, renderer.buffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(renderer.destinationLocation);
  gl.vertexAttribPointer(renderer.destinationLocation, 3, gl.FLOAT, false, 24, 0);
  gl.enableVertexAttribArray(renderer.sourceLocation);
  gl.vertexAttribPointer(renderer.sourceLocation, 3, gl.FLOAT, false, 24, 12);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, renderer.texture);
  if (renderer.textureSource !== source.currentSrc) {
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    if (gl.getError() !== gl.NO_ERROR) return false;
    renderer.textureSource = source.currentSrc;
  }
  gl.uniform2f(renderer.sourceSizeLocation, source.naturalWidth, source.naturalHeight);
  gl.drawArrays(gl.TRIANGLES, 0, indices.length);
  return gl.getError() === gl.NO_ERROR;
}

function disposeGateProjectionRenderer(renderer: GateProjectionRenderer) {
  const { gl } = renderer;
  gl.deleteBuffer(renderer.buffer);
  gl.deleteTexture(renderer.texture);
  gl.deleteProgram(renderer.program);
}

export type ReactionGateLayerProps = {
  released: boolean;
  onSettled: () => void;
};

export function ReactionGateLayer({ released, onSettled }: ReactionGateLayerProps) {
  const layerRef = useRef<HTMLDivElement | null>(null);
  const coordinateSpaceRef = useRef<HTMLDivElement | null>(null);
  const gateCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const gateFallbackCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const gateSourceRef = useRef<HTMLImageElement | null>(null);
  const projectionRendererRef = useRef<GateProjectionRenderer | null | undefined>(undefined);
  const progressRef = useRef(0);
  const animationFrameRef = useRef<number | null>(null);
  const onSettledRef = useRef(onSettled);

  useEffect(() => {
    onSettledRef.current = onSettled;
  }, [onSettled]);

  useEffect(() => {
    const layer = layerRef.current;
    const coordinateSpace = coordinateSpaceRef.current;
    if (!layer || !coordinateSpace) return undefined;
    const updateScale = () => {
      const { width, height } = layer.getBoundingClientRect();
      coordinateSpace.style.transform = `scale(${width / SCENE_WIDTH}, ${height / SCENE_HEIGHT})`;
    };
    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(layer);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => {
    if (projectionRendererRef.current && !projectionRendererRef.current.gl.isContextLost()) {
      disposeGateProjectionRenderer(projectionRendererRef.current);
    }
    projectionRendererRef.current = undefined;
  }, []);

  const paintFallback = useCallback((progress: number, rendererName: string) => {
    const primaryCanvas = gateCanvasRef.current;
    const fallbackCanvas = gateFallbackCanvasRef.current;
    const source = gateSourceRef.current;
    const layer = layerRef.current;
    if (!primaryCanvas || !fallbackCanvas || !source || !layer) return false;
    const context = fallbackCanvas.getContext('2d');
    if (!context) return false;
    drawGateFallback(context, source, progress);
    primaryCanvas.style.visibility = 'hidden';
    fallbackCanvas.style.visibility = 'visible';
    layer.dataset.gateRenderer = rendererName;
    return true;
  }, []);

  const paint = useCallback((progress: number) => {
    const gate = gateCanvasRef.current;
    const fallbackCanvas = gateFallbackCanvasRef.current;
    const source = gateSourceRef.current;
    const layer = layerRef.current;
    if (!gate || !fallbackCanvas || !source || !layer) return;
    const normalized = Math.min(1, Math.max(0, progress));
    progressRef.current = normalized;
    if (source.complete && source.naturalWidth > 0) {
      if (projectionRendererRef.current === undefined) {
        // Acquire WebGL before any 2D context. Rendering the projective plane
        // directly avoids a full-canvas GPU readback on every animation frame.
        projectionRendererRef.current = createGateProjectionRenderer(gate);
      }
      const renderer = projectionRendererRef.current;
      if (renderer) {
        if (drawGateProjectively(renderer, source, normalized)) {
          gate.style.visibility = 'visible';
          fallbackCanvas.style.visibility = 'hidden';
          layer.dataset.gateRenderer = 'projective-single-plane';
        } else {
          paintFallback(
            normalized,
            renderer.gl.isContextLost()
              ? 'projective-context-fallback'
              : 'projective-runtime-fallback',
          );
          if (!renderer.gl.isContextLost()) {
            disposeGateProjectionRenderer(renderer);
            projectionRendererRef.current = null;
          }
        }
      } else {
        paintFallback(normalized, 'projective-mesh-fallback');
      }
    }
    layer.dataset.gateProgress = normalized.toFixed(3);
  }, [paintFallback]);

  useEffect(() => {
    const canvas = gateCanvasRef.current;
    const layer = layerRef.current;
    if (!canvas || !layer) return undefined;
    const handleContextLost = (event: Event) => {
      event.preventDefault();
      paintFallback(progressRef.current, 'projective-context-fallback');
    };
    const handleContextRestored = () => {
      // WebGL invalidates every pre-loss resource. Deleting those stale
      // handles after restoration itself raises INVALID_OPERATION, so discard
      // the old renderer and build clean resources on the restored context.
      projectionRendererRef.current = undefined;
      paint(progressRef.current);
    };
    canvas.addEventListener('webglcontextlost', handleContextLost);
    canvas.addEventListener('webglcontextrestored', handleContextRestored);
    return () => {
      canvas.removeEventListener('webglcontextlost', handleContextLost);
      canvas.removeEventListener('webglcontextrestored', handleContextRestored);
    };
  }, [paint, paintFallback]);

  useEffect(() => {
    if (animationFrameRef.current != null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (!released) {
      paint(0);
      return undefined;
    }
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      paint(1);
      onSettledRef.current();
      return undefined;
    }
    const startedAt = performance.now();
    const animate = (now: number) => {
      const linear = Math.min(1, (now - startedAt) / REACTION_GATE_DROP_MS);
      // Gravity accelerates the exact selected gate toward the dirt; timing and
      // scoring remain owned by the fourth UCI cadence event.
      paint(linear * linear);
      if (linear < 1) {
        animationFrameRef.current = window.requestAnimationFrame(animate);
      } else {
        animationFrameRef.current = null;
        onSettledRef.current();
      }
    };
    animationFrameRef.current = window.requestAnimationFrame(animate);
    return () => {
      if (animationFrameRef.current != null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [paint, released]);

  return (
    <div
      aria-hidden="true"
      className="reaction-gate-layer"
      data-gate-flush-quad={REACTION_GATE_FLUSH_QUAD.map(({ x, y }) => `${x},${y}`).join(' ')}
      data-gate-motion="single-rigid-source"
      data-gate-projection="fixed-hinge-world-rotation"
      data-gate-progress="0.000"
      ref={layerRef}
    >
      <div className="reaction-gate-coordinate-space" ref={coordinateSpaceRef}>
        <canvas
          className="reaction-gate-canvas"
          height={SCENE_HEIGHT}
          ref={gateCanvasRef}
          width={SCENE_WIDTH}
        />
        <canvas
          className="reaction-gate-fallback-canvas"
          height={SCENE_HEIGHT}
          ref={gateFallbackCanvasRef}
          width={SCENE_WIDTH}
        />
        <img
          alt=""
          className="reaction-gate-selected-source"
          draggable={false}
          height={SCENE_HEIGHT}
          onLoad={() => paint(progressRef.current)}
          ref={gateSourceRef}
          src="/assets/reaction-test-eight-lane-gate-source.png"
          width={SCENE_WIDTH}
        />
      </div>
    </div>
  );
}
