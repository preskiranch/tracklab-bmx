import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../../src/lib/racingTrackDirectory.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
export const { isRacingDirectoryTrack } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
