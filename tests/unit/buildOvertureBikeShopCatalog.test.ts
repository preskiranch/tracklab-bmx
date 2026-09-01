import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const gunzipAsync = promisify(gunzip);

describe('Overture bike shop catalog builder', () => {
  it('filters, deterministically deduplicates, and preserves upstream source lineage', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'tracklab-overture-builder-'));
    const inputPath = path.join(directory, 'shops.ndjson');
    const outputPath = path.join(directory, 'shops.json.gz');
    const id = '11111111-1111-4111-8111-111111111111';
    const duplicateId = '22222222-2222-4222-8222-222222222222';
    const records = [
      {
        id,
        name: "Ray's Cycle",
        latitude: 38.356,
        longitude: -121.987,
        category: 'bike_store',
        confidence: 0.91,
        address: '400 Main St',
        locality: 'Vacaville',
        region: 'California',
        country_code: 'US',
        source_provenance: ['meta|CDLA-Permissive-2.0|meta|2026-08-01T00:00:00Z'],
      },
      {
        id: duplicateId,
        name: "Ray's Cycle",
        latitude: 38.3561,
        longitude: -121.9871,
        category: 'bike_repair_maintenance',
        confidence: 0.8,
        phone: '555-0100',
        source_provenance: ['fsq|Apache-2.0|foursquare|2026-08-02T00:00:00Z'],
      },
      {
        id: '33333333-3333-4333-8333-333333333333',
        name: 'Low confidence listing',
        latitude: 38.35,
        longitude: -121.98,
        category: 'bike_store',
        confidence: 0.49,
      },
      {
        id: '44444444-4444-4444-8444-444444444444',
        name: '自行车维修中心',
        latitude: 31.2304,
        longitude: 121.4737,
        category: 'bike_repair_maintenance',
        confidence: 0.88,
        locality: '上海市',
        country_code: 'CN',
      },
    ];
    await writeFile(inputPath, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`);

    try {
      await execFileAsync(process.execPath, [
        path.join(process.cwd(), 'scripts/build-overture-bike-shop-catalog.mjs'),
        inputPath,
        outputPath,
      ], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          TRACKLAB_OVERTURE_RELEASE: '2026-08-19.0',
          TRACKLAB_OVERTURE_MINIMUM_CONFIDENCE: '0.50',
        },
      });
      const artifactLines = (await gunzipAsync(await readFile(outputPath)))
        .toString('utf8')
        .trim()
        .split('\n');
      const artifact = JSON.parse(artifactLines[0]);
      const shops = artifactLines.slice(1).map((line) => JSON.parse(line));
      expect(artifact).toMatchObject({
        schemaVersion: 2,
        format: 'tracklab-overture-bike-shop-ndjson-v1',
        release: '2026-08-19.0',
        minimumConfidence: 0.5,
        inputRecords: 4,
        acceptedRecordsBeforeDedupe: 3,
        recordCount: 2,
        duplicatesMerged: 1,
        licenses: ['CDLA-Permissive-2.0', 'Apache-2.0', 'CC0-1.0'],
        sourceProvenanceEncoding: 'dataset|license|provider|update_time',
      });
      expect(artifact.catalogSha256).toBe(
        createHash('sha256').update(JSON.stringify(shops)).digest('hex'),
      );
      expect(shops).toEqual([[
        id,
        "Ray's Cycle",
        38.356,
        -121.987,
        '400 Main St',
        'Vacaville',
        'California',
        '',
        'US',
        '',
        '555-0100',
        'bike_store_and_repair',
        0.91,
        [
          'fsq|Apache-2.0|foursquare|2026-08-02T00:00:00Z',
          'meta|CDLA-Permissive-2.0|meta|2026-08-01T00:00:00Z',
        ],
      ], [
        '44444444-4444-4444-8444-444444444444',
        '自行车维修中心',
        31.2304,
        121.4737,
        '',
        '上海市',
        '',
        '',
        'CN',
        '',
        '',
        'bike_repair_maintenance',
        0.88,
        [],
      ]]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('bundles the required Overture and upstream license notices', async () => {
    const [cdla, apache, foursquare, notice] = await Promise.all([
      readFile(path.join(process.cwd(), 'data/bike-shops/CDLA-Permissive-2.0.txt'), 'utf8'),
      readFile(path.join(process.cwd(), 'data/bike-shops/Apache-2.0.txt'), 'utf8'),
      readFile(path.join(process.cwd(), 'data/bike-shops/Foursquare-NOTICE.txt'), 'utf8'),
      readFile(path.join(process.cwd(), 'data/bike-shops/NOTICE.md'), 'utf8'),
    ]);
    expect(cdla).toContain('Community Data License Agreement - Permissive - Version 2.0');
    expect(apache).toContain('Apache License');
    expect(apache).toContain('Version 2.0, January 2004');
    expect(foursquare).toContain('Foursquare');
    expect(notice).toContain('Overture Maps Places');
    expect(notice).toContain('confidence threshold of `0.50`');
  });
});
