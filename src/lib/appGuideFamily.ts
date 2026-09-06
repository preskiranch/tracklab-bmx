import type { AppGuideSection } from './appGuideTypes';

export const familyGuideSection: AppGuideSection = {
  id: 'family',
  title: 'Parents and family athletes',
  summary: 'One parent sign-in, separate athlete profiles, and a simple way to follow each child’s training.',
  articles: [
    {
      title: 'Keep every child’s progress separate',
      paragraphs: [
        'Open My Profile → Family, or More → Family. Select a child by name to view that athlete’s profile, personal records, training calendar, and available session details. Select another name to change the view. Each child keeps a separate record; viewing a child does not sign you into their account or change the athlete recording your current workout.',
        'Family monitoring uses your free parent account. Sign in with the same parent email on another device to see your family links. Adding children does not increase your Wattbike connection allowance or give a linked account a paid subscription.',
      ],
    },
    {
      title: 'Create a child profile without an email',
      paragraphs: [
        'A parent or guardian can create a managed child profile with a name. The child does not need an email address or password. Add each child separately, even when the same parent supervises several athletes.',
        'For an athlete who trains at a TrackLab club, connect their unclaimed Club Connect invitation to the selected managed child. This attaches that exact athlete’s available studio records and future recorded club sessions without renaming the parent or moving another child’s history.',
      ],
      steps: [
        'Open Family and add the child’s name. Confirm you are authorized to manage that athlete.',
        'Select that child, then use the studio-record connection form to paste the unclaimed invitation supplied by the club.',
        'Check the athlete and club shown in the profile, then review their recorded activity. Repeat with a separate child profile and separate club invitation for each athlete.',
      ],
    },
    {
      title: 'Link an existing athlete account with approval',
      paragraphs: [
        'If your child already has an account, create a family invitation and share its personal link with them. They open it while signed into their own TrackLab account and explicitly approve sharing their profile and training activity. Entering someone’s email or name alone never grants access. Invitations expire and can be accepted only once.',
        'The athlete can remove sharing from their own Family view, and the parent can remove an existing-account link. Unlinking leaves the athlete’s independent account and records intact.',
        'Archiving a managed child hides that profile while preserving its records and club connection. Open Archived child profiles and choose Restore to bring it back. A removed link to an independent account requires that athlete’s approval again.',
      ],
    },
    {
      title: 'Understand the records and permissions',
      paragraphs: [
        'Family activity views include supported BMX Race Intervals, Straight Sprint, Explore the World, Get Pulled, and monitor-sprint records, with available times, distance, cadence, speed, cycling power, and personal bests. Use the date and activity controls to review sessions and download available training exports. Reaction Test appears through its personal best rather than a calendar entry for every practice attempt.',
        'Family access covers the selected athlete’s authorized training data. It does not expose another rider’s records, the athlete’s entire club roster, account password, billing, Friends messages, live location, or private Apple Watch heart rate. The parent’s Watch is never substituted for the child’s readings.',
        'A managed profile can receive its connected club athlete’s records. The Family selector is for monitoring; it does not offer a separate “train as child” mode for personal home sessions. Use the correct claimed athlete at the club, or the athlete’s own account for personal training, so each new result reaches its intended profile.',
      ],
    },
  ],
};
