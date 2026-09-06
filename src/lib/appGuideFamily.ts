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
        'A parent or guardian can create a managed child profile with a name. The child does not need an email address or password. Each child can sign into their own phone using a one-use setup link approved by the parent. Add each child separately, even when the same parent supervises several athletes.',
        'For an athlete who trains at a TrackLab club, connect their unclaimed Club Connect invitation to the selected managed child. This attaches that exact athlete’s available studio records and future recorded club sessions without renaming the parent or moving another child’s history.',
      ],
      steps: [
        'Open the club’s athlete invitation and choose I’m the parent or guardian. Create or sign into your own account with your email.',
        'Enter the child’s name or choose their existing managed profile, confirm guardian authorization, and claim the studio record. You can also connect an unclaimed invitation from Family.',
        'Choose Create child-phone setup link and open it on the child’s phone within 15 minutes. Confirm the athlete’s name. The phone signs into that child’s profile; your own phone stays signed into the parent account. Repeat separately for each child.',
      ],
    },
    {
      title: 'Adults, beta installation, and child device access',
      paragraphs: [
        'Adults open their club invitation and choose I’m the athlete, then create or sign into their own account and complete their athlete profile. A valid unclaimed invitation supports either path; no replacement link is needed just because the athlete is a child. Already-claimed independent accounts use the separate Family permission link instead of claiming the studio record again.',
        'During the iOS beta, eligible parents and athletes install TrackLab through TestFlight using access provided by the beta organizer. Apple’s TestFlight terms do not permit children under 13 or the equivalent local minimum age to use TestFlight; a parent account does not bypass this rule. Younger athletes can use supported website features, while native Apple Watch access needs a suitable iOS distribution. Installing the beta and claiming a TrackLab athlete profile are separate steps. The child-phone setup link does not itself enroll an Apple account in TestFlight. Open the setup link after installing a build that supports child phone setup.',
        'Only share a child-phone setup link with that child’s device. It expires in 15 minutes and can be used once. Creating another link replaces the pending one. From the selected child in Family, a parent can sign out the child’s devices without deleting records. Archiving a child also cancels their device sign-ins; restoring the profile requires a new setup link.',
      ],
    },
    {
      title: 'A child’s Apple Watch and studio tablets',
      paragraphs: [
        'Use the child’s Apple Watch paired with the child’s own iPhone. On that iPhone, sign into the child’s TrackLab profile, open Watch Connect, and complete the Watch permissions and trusted-device setup. Watch data belongs to the child’s profile, not the parent’s account.',
        'For studio use, connect the child’s exact Club Connect roster record, then choose the studio in Watch Connect and approve the live and saved-session sharing you want. The relay is Watch to the child’s iPhone to TrackLab to the authorized studio tablet. Select that same athlete on the tablet. Another athlete’s selection must not show the child’s readings. A working network connection is needed for cloud sharing.',
        'Studio Watch sharing is separate from parent Family access. Family does not expose private heart-rate data. Apple Watch configured through a parent’s iPhone using Apple’s family setup is a different arrangement and is not verified by this child-iPhone workflow.',
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
        'A parent-managed child’s phone records personal training under that child’s existing profile. The parent’s Family view refreshes saved activity while open; results sync when devices are online. The Family selector on the parent’s phone only changes the records being viewed. It never changes who records the parent’s workout. Studio-attributed sessions remain visible to the connected club under the same roster athlete.',
      ],
    },
  ],
};
