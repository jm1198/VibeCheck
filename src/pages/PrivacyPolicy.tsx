import { useNavigate } from "react-router-dom";

const CONTACT_EMAIL = "support.vibecheck.sd@gmail.com";

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-2xl font-bold text-vibe-text tracking-tight mb-3 mt-10">
      {children}
    </h2>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5 leading-relaxed">
      <span className="text-vibe-accent font-bold shrink-0 mt-px">•</span>
      <span>{children}</span>
    </li>
  );
}

function EmailLink() {
  return (
    <a
      href={`mailto:${CONTACT_EMAIL}`}
      className="text-vibe-accent font-semibold hover:underline"
    >
      {CONTACT_EMAIL}
    </a>
  );
}

export default function PrivacyPolicy() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-vibe-bg">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
        {/* Header */}
        <div className="flex items-center justify-center mb-8">
          <img src="/icon-192.png" alt="VibeCheck logo" className="w-14 h-14 rounded-2xl shadow-md" />
        </div>
        <div className="text-center mb-10">
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-tight" style={{ fontFamily: "'Playfair Display', Georgia, serif" }}>
            <span className="gradient-text">VibeCheck</span>
          </h1>
          <p className="text-vibe-muted mt-4 text-base sm:text-lg font-medium">
            Privacy Policy
          </p>
        </div>

        {/* Content */}
        <div className="bg-vibe-card border border-vibe-border rounded-2xl p-6 sm:p-8 shadow-card">
          {/* Our Privacy Promise */}
          <SectionHeading>Our Privacy Promise</SectionHeading>
          <p className="mb-4">
            VibeCheck lets you check the real-time vibe of bars and clubs before you head out — how busy, how lively, how chill. We built the product to show the <strong>energy of the room, not the people in it</strong>. This policy explains, in plain language, what data we collect, how we use it, and the choices you have. If anything here is unclear, email us at <EmailLink /> and we'll answer honestly.
          </p>
          <div className="bg-vibe-surface border border-vibe-border rounded-xl p-5 mb-6">
            <p className="font-bold text-vibe-text mb-3">The short version:</p>
            <ul className="space-y-2 text-vibe-text-secondary">
              <Bullet>We collect the basics needed to run the app: your account info, what you watch, and basic analytics.</Bullet>
              <Bullet>We use automated/AI tools in building and improving this app.</Bullet>
              <Bullet>We share some data with trusted service providers (analytics, cloud hosting) and with third-party companies that collect data.</Bullet>
              <Bullet>Your data lives in a <strong>private storage bucket</strong> — it is not publicly accessible.</Bullet>
              <Bullet>Live venue feeds are privacy-protected by design: no audio, no face-level detail, no recordings.</Bullet>
            </ul>
          </div>

          {/* Information We Collect */}
          <SectionHeading>Information We Collect</SectionHeading>
          <p className="mb-3"><strong>Account information.</strong> When you create an account, we collect what you give us — such as your name, email address, and password. If you add profile details (like a username or photo), we store those too.</p>
          <p className="mb-3"><strong>Location and venue views.</strong> The app is built around venues near you. We collect and store the venues you view, search for, or save, and — if you allow it — your approximate location, so we can suggest nearby spots and show you what's happening around you.</p>
          <p className="mb-3"><strong>Live feed viewing activity.</strong> When you watch a live venue feed, we record that activity — which feed you watched and when. We use this to show you relevant venues and to measure how well venue feeds are doing.</p>
          <p className="mb-3"><strong>Device and basic analytics.</strong> We automatically collect basic technical information about how you use the app: device type, operating system, app version, crash reports, and general usage patterns (like which screens you visit). This helps us keep the app working and improving.</p>
          <p className="mb-3"><strong>Payment information (venue owners).</strong> If you are a venue owner with a subscription, payment is processed by a payment provider — we do not store full card numbers ourselves.</p>

          {/* How We Use It */}
          <SectionHeading>How We Use It</SectionHeading>
          <p className="mb-3">We use the information we collect to:</p>
          <ul className="space-y-2 mb-3">
            <Bullet><strong>Run the app</strong> — create and manage your account, show live feeds, save your preferences, and keep things working.</Bullet>
            <Bullet><strong>Show you relevant venues</strong> — recommend nearby venues and feeds based on location and what you watch.</Bullet>
            <Bullet><strong>Improve the product</strong> — analyze usage to fix bugs, improve performance, and decide what to build next.</Bullet>
            <Bullet><strong>Communicate with you</strong> — send account notifications and, with your consent, occasional updates about the app.</Bullet>
            <Bullet><strong>Measure success</strong> — understand how many people watch feeds and whether they visit venues, so we can keep the service free for consumers and valuable for venues.</Bullet>
          </ul>
          <p className="mb-3">
            We do <strong>not</strong> sell your personal information to advertisers. We do not use your data to build profiles for ad targeting.
          </p>

          {/* Sharing with Third Parties */}
          <SectionHeading>Sharing with Third Parties / Data Collectors</SectionHeading>
          <p className="mb-3">We keep your data with us whenever we can, but running a modern app requires help from trusted third parties. We share data with:</p>
          <ul className="space-y-2 mb-3">
            <Bullet><strong>Analytics providers</strong> — companies that help us understand how the app is used (usage patterns, crash reports, and similar). These are third-party companies that collect data on our behalf.</Bullet>
            <Bullet><strong>Infrastructure and cloud providers</strong> — companies that host our servers, store our data, and deliver video streams. They process data only to provide us those services.</Bullet>
            <Bullet><strong>Third-party data-collecting companies</strong> — in the course of operating the app, some data may be shared with third-party companies that collect and hold data for their own business operations, as is standard across the app industry.</Bullet>
          </ul>
          <p className="mb-3">
            We also share data where required by law, to protect our rights or the safety of our users, or with venue owners as needed to operate their feeds. We require the services we work with to use your data only for the purposes we've agreed.
          </p>

          {/* AI in Our Product */}
          <SectionHeading>AI in Our Product</SectionHeading>
          <p className="mb-3">We use <strong>AI and automated tools in the development of our application</strong> — for example, to help write and improve code, generate content, and build features. AI helps us build a better product, faster.</p>
          <p className="mb-3">
            We do <strong>not</strong> use AI to identify or track individuals in live venue feeds. Our feeds are designed to show crowd energy and atmosphere — not identifiable people.
          </p>

          {/* Data Storage & Security */}
          <SectionHeading>Data Storage & Security</SectionHeading>
          <p className="mb-3">
            Your data is stored in a <strong>private storage bucket</strong> — meaning it is kept in access-controlled storage that is not publicly accessible. Only authorized systems and people can reach it, and only for the purposes described in this policy.
          </p>
          <p className="mb-3">
            We take reasonable technical and organizational measures to protect your data, including access controls and secure connections (encryption in transit). No method of storage or transmission is 100% secure, but we work hard to keep your data safe.
          </p>
          <p className="mb-3">
            We keep your data only as long as needed for the purposes in this policy, and delete or anonymize it when it's no longer needed. If you close your account, we delete (or anonymize) your personal data unless we're legally required to keep it.
          </p>

          {/* Your Choices & Rights */}
          <SectionHeading>Your Choices & Rights</SectionHeading>
          <ul className="space-y-2 mb-3">
            <Bullet><strong>Access and correction.</strong> You can review and update your account information in the app at any time.</Bullet>
            <Bullet><strong>Location.</strong> You can turn off location access in your device settings; the app will still work, just with less personalized suggestions.</Bullet>
            <Bullet><strong>Delete your account.</strong> You can close your account at any time. We'll delete or anonymize your personal data.</Bullet>
            <Bullet><strong>Contact us.</strong> To exercise any of these rights, or ask questions about your data, email <EmailLink />.</Bullet>
          </ul>
          <p className="mb-3">
            If you're in a jurisdiction with data-protection laws (like the GDPR or CCPA), we honor your rights under those laws, including access, correction, deletion, and portability where they apply.
          </p>

          {/* Privacy Playbook */}
          <SectionHeading>The VibeCheck Privacy Playbook (for live venue feeds)</SectionHeading>
          <p className="mb-3">VibeCheck is built around live camera feeds from partner venues. We hold our venues to a strict privacy standard, and it's part of the experience you can count on:</p>
          <ul className="space-y-2 mb-3">
            <Bullet><strong>Crowd energy, not people.</strong> Feeds use high-angle, wide shots designed to capture density and atmosphere — never face-level detail.</Bullet>
            <Bullet><strong>No audio, ever.</strong> Live feeds are video-only. Audio is dropped at every layer of the pipeline, so conversations stay private.</Bullet>
            <Bullet><strong>Low resolution, no recordings.</strong> Public feeds are low-resolution — enough to see busy vs. chill, not enough to identify faces. Nothing is recorded or stored.</Bullet>
            <Bullet><strong>Visible signage.</strong> Every venue must post a clear notice that a VibeCheck live crowd cam is in use.</Bullet>
            <Bullet><strong>Venue control.</strong> Venues can pause or disable their feed at any time, and feeds are only live during business hours.</Bullet>
            <Bullet><strong>Trust badge.</strong> Venues that follow the full privacy playbook earn a visible trust badge in the app, so you know the feed meets our standards.</Bullet>
          </ul>
          <p className="mb-3">
            If you believe a venue is not following this playbook, tell us at <EmailLink /> and we'll look into it.
          </p>

          {/* Contact */}
          <SectionHeading>Contact</SectionHeading>
          <p className="mb-3">Questions, requests, or concerns about this policy or your data:</p>
          <ul className="space-y-2 mb-3">
            <Bullet><strong>Email:</strong> <EmailLink /></Bullet>
          </ul>
          <p className="mb-3">
            We may update this policy from time to time. If we make material changes, we'll let you know in the app or by email before they take effect.
          </p>
        </div>

        {/* Back */}
        <div className="text-center mt-8">
          <button
            onClick={() => navigate(-1)}
            className="text-vibe-muted hover:text-vibe-text text-sm transition-colors"
          >
            ← Back
          </button>
        </div>
      </div>
    </div>
  );
}
