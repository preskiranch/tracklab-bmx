import type { AppGuideSection } from './appGuideTypes';

export const betaGuideSection: AppGuideSection = {
  id: 'beta-start',
  title: 'Start testing TrackLab',
  summary: 'Free public beta testing is currently ongoing. Sign in for beta access, connect a compatible Wattbike, and send useful feedback.',
  articles: [
    {
      title: 'Verify your email or recover your password',
      paragraphs: [
        'New accounts verify their email once before signing in. Open the verification email, select Verify email, then return to your original TrackLab app or tab and sign in. Your athlete invitation stays in that original tab. Existing accounts keep their access; verification is not repeated at every login.',
        'Use Forgot password on the sign-in screen to request a reset email. The link lasts 30 minutes and can be used once. After saving a new password, sign in again. Your old password and account sessions stop working.',
        'If a verification email is missing, check spam and use Resend verification email. Wait one minute between requests. Verification links last 24 hours. Correct signup email lets you fix a typo before verification using your existing password.',
        'Parents verify their own email. A child using a parent-managed profile does not need an email address or separate password. Parent-issued child-phone setup links continue to work.',
      ],
    },
    {
      title: 'Start your automatic beta access',
      paragraphs: [
        'While public beta enrollment is open, signing in automatically gives a new tester four simultaneous Wattbike connections, including parent-managed athletes using their own phone setup. This works on the native app and website and requires no separate beta invitation or purchase. Access has a fixed end date shown in More → Beta Testing and lasts no more than 90 days. Signing in again does not extend or restore expired or revoked access. Administrators can also issue individual invitations: Each link belongs to one email address, can be accepted once, and expires after seven days. The testing period begins when you accept. The default invitation includes four simultaneous Wattbike connections for 90 days; your invitation may have a different connection allowance or duration.',
      ],
      steps: [
        'Install the eligible TestFlight build, or open the TrackLab website, then sign in.',
        'Create your own account, or use the parent-managed child-phone setup link for the child. Complete the requested profile details.',
        'Open More → Beta Testing to confirm four Wattbike connections and the access end date. If you have an individual invitation instead, open and accept it using its intended account.',
        'Use this same TrackLab account on your other devices. An account invitation and a TestFlight installation invitation are separate: install the iPhone or iPad beta through the TestFlight invitation supplied to you.',
      ],
    },
    {
      title: 'What the beta includes',
      paragraphs: [
        'Active beta access lets you connect Wattbikes within your allowance, train, upload supported live records, and race available ghosts. Live multiplayer is labeled Coming soon. That pause does not switch off cloud records or ghost racing.',
        'Beta access ends on its displayed date or if the administrator revokes it. It does not automatically become a paid subscription. An existing Apple subscription is separate and continues under its own terms. When both entitlements are active, TrackLab uses the larger connection allowance, up to four; the allowances do not add together. Ending beta access does not itself delete your saved profile or history.',
      ],
    },
    {
      title: 'A useful beta test session',
      paragraphs: [
        'Try the features that match your equipment and account. Note the device and approximate time of a problem so the team can follow the same steps.',
      ],
      bullets: [
        'Discovery: find a BMX track, open a nearby bike shop, then open a nearby track from that shop. Check directions, listed contact details, and your Back navigation.',
        'BMX Race Intervals: choose Ready to race and try a mapped course with your Wattbike at level 1. Use All tracks · Request mapping to request a future course. The pedal zones approximate typical pedaling areas using available imagery; tracks may have changed. Tell us how the interval rhythm feels and flag outdated mapping.',
        'Connection: pair your Wattbike, verify fresh watts and cadence, complete a short activity, and confirm the result appears in your training history.',
        'Explore: build one Smart Route and one route from a typed Starting location and Destination. Try pause/resume and Recent routes.',
        'Reaction Test: check the complete tree and gate, the stopped light, gate motion, and drop/return sounds on your device.',
        'Records: review a compatible ghost, your session details, and an export. Sign into the same account on another device to confirm saved data is available.',
        'Family: with permission, add separate athlete profiles, switch between their names, and confirm that each view contains only that athlete’s records. Check existing-account approval and removal of sharing.',
      ],
    },
    {
      title: 'Prepare your bike and report an issue',
      paragraphs: [
        'For a Wattbike Trainer or Pro, compatibility depends on its monitor, enabled wireless services, and the device running TrackLab. Put a compatible monitor in Just Ride, enable the relevant Bluetooth settings, and pedal to wake it. Native iPhone/iPad pairing differs from browser pairing; consult the connection guide for your platform. A model name or country alone does not guarantee that every monitor and firmware combination has been validated.',
      ],
      steps: [
        'Check that the expected bike appears and its live cadence and power respond before beginning a test.',
        'Open More → Beta Testing → Send beta feedback. Your email app opens a draft that you review before sending.',
        'Include what you expected, what happened, the steps to reproduce it, device and operating system, bike monitor and connection method, and whether it happened in a demo or a live ride. Add screenshots when helpful.',
      ],
    },
  ],
};

export const accountGuideSections: AppGuideSection[] = [
  {
    id: 'membership',
    title: 'Membership and Wattbike access',
    summary: 'Understand free accounts, temporary beta access, and Apple subscriptions when available.',
    articles: [
      {
        title: 'Start with a free account',
        paragraphs: [
          'Free membership includes the global BMX track directory and global bike shop directory, Reaction Test, a community profile, and saved track favorites. Sign in to keep account features associated with your profile. Live personal Wattbike training requires active Racer access, which can come from automatic public beta enrollment, an individual beta invitation, or a verified subscription when purchasing is available.',
          'An athlete can view and download their claimed club training history without buying a personal bike connection. Training through an enrolled club uses that club’s available capacity. Personal pairing at home requires your own active Wattbike access.',
        ],
      },
      {
        title: 'Choose a connection plan when purchasing is available',
        paragraphs: [
          'TrackLab’s Apple subscription options are auto-renewing monthly plans for one, two, three, or four simultaneous Wattbike connections. These are connection allowances, not a promise of unlimited bikes on every device. Use the current access and capacity messages to check what is available to your account.',
          'Purchases require the native iPhone or iPad app, a completed signed-in profile, an available App Store price, and a ready subscription service. The app displays Apple’s localized price before purchase. If it says billing is being configured or the price is unavailable, purchasing is unavailable; no price is implied by this guide.',
        ],
        steps: [
          'Sign in to the TrackLab account that should receive access.',
          'Open membership options, select the needed connection count, and review Apple’s displayed price and subscription terms.',
          'Complete the Apple purchase when enabled. Sign in with the same TrackLab account on another supported device to use its verified capacity.',
        ],
      },
      {
        title: 'Restore, manage, or cancel',
        paragraphs: [
          'Use Restore Purchases in the native app when available to verify an existing purchase with Apple. Use the purchasing Apple Account and the intended TrackLab account. Restore is also unavailable while TrackLab’s subscription verification service is not ready.',
          'Manage Subscription opens Apple’s subscription controls. Apple manages renewal and cancellation; deleting TrackLab or its account does not cancel Apple billing. Access follows the entitlement Apple verifies, including its expiration or an applicable verified grace period. An active beta grant can continue to provide its own allowance after paid access ends.',
        ],
      },
    ],
  },
  {
    id: 'profile-sync',
    title: 'Your profile, records, and privacy',
    summary: 'See what follows your account, what stays on a device, and what an export contains.',
    articles: [
      {
        title: 'Use the same account across devices',
        paragraphs: [
          'Cloud profile data includes your profile photo and supported personal records, display units, saved bike names and colors, and custom routes. Track mappings, studio riders, and camera preferences have role or administrator restrictions. Friends, favorites, training history, and recovery settings also use account services; they are not all stored in one profile document.',
          'Saved training history covers supported BMX races, Straight Sprint, Explore rides, Get Pulled tests, and monitor sprints. Reaction Test keeps its separate personal best instead of adding each practice attempt to the training calendar. Demo races are not uploaded as your completed live race results.',
        ],
        steps: [
          'Sign in with the same account, then open My Profile to inspect saved history and records.',
          'Finish a supported live activity while connected to the service, then confirm that its saved result appears.',
          'On another device, sign in and refresh or reopen the profile. Check the cloud status if recent changes are missing.',
        ],
      },
      {
        title: 'Device storage and connection limits',
        paragraphs: [
          'Bluetooth permission and remembered native bike identifiers belong to each device. A synced bike name does not grant another device permission to connect. Pair there when prompted. Local browser storage provides fallback for some settings when cloud access fails, but not every setting or failed ride upload has guaranteed offline delivery. Confirm important results in cloud history before relying on another device to retrieve them.',
        ],
      },
      {
        title: 'Download the appropriate record',
        paragraphs: [
          'My Profile offers per-session JSON/CSV and daily Numbers/Excel workbooks. Standard training exports contain non-health training data. A separately labeled private workbook includes only authorized Apple Watch summaries. Shared race-capture exports remove private power; other riders’ ghost analytics also redact power. Your own authorized training records can contain your power metrics.',
          'Apple Watch heart rate is private by default and excluded from public race, leaderboard, friend, and ghost data. Club access follows the rider’s authorization and sharing choices. A friendship alone does not grant access to heart rate.',
        ],
      },
    ],
  },
  {
    id: 'watch-recovery',
    title: 'Apple Watch and recovery',
    summary: 'Add optional heart rate and recovery reminders to supported training.',
    articles: [
      {
        title: 'Connect Apple Watch through its paired iPhone',
        paragraphs: [
          'Training works without Apple Watch. For heart rate, set up Watch Connect on the paired iPhone and approve the requested Apple Health permissions. The remembered connection runs for four hours; start another connection on the paired iPhone when it ends. Keep the iPhone and Watch nearby and online. An iPad can receive readings through the iPhone relay.',
          'Personal account recording attaches private heart-rate windows to supported sessions. Studio Watch enrollment asks for training-summary consent; live BPM sharing is a separate choice. Shared summaries contain minimum, average, peak, coverage, and supported zone summaries, not raw samples. Check signal and coverage indicators if readings are interrupted. Use the workout controls to end and save the workout to Apple Health when offered.',
        ],
      },
      {
        title: 'Set Recovery Alert',
        paragraphs: [
          'Recovery settings save to your account for Race Intervals, Straight Sprint, and Get Pulled. Choose Off, Timer, Heart rate, or Smart, adjust the settings, and save. Timer recovery begins at the recorded finish. Heart-rate recovery uses a fresh Watch reading held at the target for 12 seconds, with the configured timing fallback when readings are unavailable.',
          'Smart recovery begins with your chosen time and learns from clean recovery episodes and aggregate effort data. It is a training estimate, not a measurement of breathing or a medical assessment. Recovery alerts never start the next repetition for you. Background Apple notifications and Watch taps require compatible native support and device permissions; the in-app alert remains available.',
        ],
      },
    ],
  },
];
