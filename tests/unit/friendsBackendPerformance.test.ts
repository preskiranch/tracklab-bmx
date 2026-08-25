import { describe, expect, it } from 'vitest';
import { persistenceTestHooks } from '../../cloud/persistence.mjs';

describe('Friends backend query shape', () => {
  it('loads the requested profiles and exact totals in one bounded PostgreSQL statement', () => {
    const sql = persistenceTestHooks.accountFriendsPageStatement();

    expect(sql).toContain('matching_friends AS MATERIALIZED');
    expect(sql).toContain('SELECT count(*)::integer AS total FROM matching_friends');
    expect(sql).toContain('OFFSET $2 LIMIT $3');
    expect(sql).toContain('friend_total.total AS total_count');
    expect(sql).toContain('online_total.total AS online_total_count');
    expect(sql).toContain('profile_id = ANY($5::text[])');
    expect(sql).toContain("friendship_source <> 'official' OR official_type IS NOT NULL");
    expect(sql.match(/account_friendships/g)).toHaveLength(2);

    // Photo JSON and the recent-ghost lateral lookup must run only after the
    // requested friend IDs have been paged, not across the entire graph.
    expect(sql.indexOf('LEFT JOIN paged_friends')).toBeLessThan(
      sql.indexOf('LEFT JOIN tracklab.user_data'),
    );
    expect(sql.indexOf('LEFT JOIN paged_friends')).toBeLessThan(
      sql.indexOf('LEFT JOIN LATERAL'),
    );
  });

  it('finds presence viewers with two indexable friendship-edge scans', () => {
    const sql = persistenceTestHooks.accountFriendPresenceAudienceStatement();

    expect(sql).toContain('friend_edges AS MATERIALIZED');
    expect(sql).toContain('WHERE user_id_a = $1');
    expect(sql).toContain('WHERE user_id_b = $1');
    expect(sql).toContain('UNION ALL');
    expect(sql).toContain("edge.source <> 'official' OR target.is_official");
    expect(sql.match(/account_friendships/g)).toHaveLength(2);
    expect(sql).not.toMatch(/user_id_a = \$1 OR user_id_b = \$1/);
  });

  it('loads each request direction and its total without a duplicate count query', () => {
    for (const direction of ['incoming', 'outgoing']) {
      const sql = persistenceTestHooks.accountFriendRequestsPageStatement(direction);
      expect(sql).toContain('matching_requests AS MATERIALIZED');
      expect(sql).toContain('SELECT count(*)::integer AS total FROM matching_requests');
      expect(sql).toContain('OFFSET $2 LIMIT $3');
      expect(sql).toContain('request_total.total AS total_count');
      expect(sql.match(/account_friend_requests/g)).toHaveLength(1);
      expect(sql).toContain(direction === 'incoming'
        ? 'request.to_user_id = $1'
        : 'request.from_user_id = $1');
    }
  });
});
