import { describe, expect, it, vi } from 'vitest';
import {
  generateSmartExplorePlan,
  sanitizeSmartExplorePlan,
} from '../../cloud/exploreSmartRoute.mjs';

describe('Smart Explore route planning', () => {
  it('sanitizes a sourced event-stage plan into geocodable checkpoints', () => {
    expect(sanitizeSmartExplorePlan({
      name: ' Tour de France Stage 3 ',
      summary: 'Verified stage checkpoints.',
      originQuery: 'Start Village, France',
      destinationQuery: 'Finish City, France',
      waypointQueries: ['Checkpoint One, France', 'Checkpoint Two, France'],
      targetDistanceMiles: 130,
      routeKind: 'event-stage',
      disclaimer: 'Approximation between verified checkpoints.',
    }, [{ title: 'Official stage', url: 'https://example.com/stage-3' }])).toMatchObject({
      name: 'Tour de France Stage 3',
      originQuery: 'Start Village, France',
      destinationQuery: 'Finish City, France',
      waypointQueries: ['Checkpoint One, France', 'Checkpoint Two, France'],
      routeKind: 'event-stage',
      sources: [{ title: 'Official stage', url: 'https://example.com/stage-3' }],
    });
  });

  it('requires web research and returns provider sources separately from route facts', async () => {
    const fetchImplementation = vi.fn(async (_url: string, request: RequestInit) => {
      const body = JSON.parse(String(request.body));
      expect(body.tools).toEqual([{ type: 'web_search', search_context_size: 'medium' }]);
      expect(body.tool_choice).toBe('required');
      return new Response(JSON.stringify({
        output_text: JSON.stringify({
          name: 'Malibu Coast Ten',
          summary: 'A coastal route using well-known public landmarks.',
          originQuery: 'Malibu Pier, Malibu, CA',
          destinationQuery: 'Zuma Beach, Malibu, CA',
          waypointQueries: ['Point Dume, Malibu, CA'],
          targetDistanceMiles: 10,
          routeKind: 'point-to-point',
          disclaimer: 'Google determines the final route and distance.',
        }),
        output: [{
          type: 'web_search_call',
          action: { sources: [{ title: 'Visit Malibu', url: 'https://example.com/malibu' }] },
        }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });

    await expect(generateSmartExplorePlan({
      description: 'A 10 mile coastal ride in Malibu with ocean views',
      apiKey: 'test-key',
      model: 'test-model',
      fetchImplementation,
    })).resolves.toMatchObject({
      name: 'Malibu Coast Ten',
      targetDistanceMiles: 10,
      sources: [{ title: 'Visit Malibu', url: 'https://example.com/malibu' }],
    });
  });
});
