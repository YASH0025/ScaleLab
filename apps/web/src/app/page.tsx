import Link from 'next/link';

const STEPS = [
  { n: '1', title: 'Design it', text: 'Drag in Next.js, Spring Boot, Redis, PostgreSQL and more. Attach the libraries you use.' },
  { n: '2', title: 'Run it', text: 'Send real-world-like traffic and watch every request travel through your system.' },
  { n: '3', title: 'Break it', text: 'Kill a server, slow the database, spike the traffic. See what fails and why.' },
  { n: '4', title: 'Fix it', text: 'Add a cache or a replica, rerun the same traffic, and watch the red turn green.' },
];

export default function Home() {
  return (
    <main className="relative min-h-screen overflow-hidden">
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-60"
        style={{ backgroundImage: 'radial-gradient(#1d2331 1px, transparent 1px)', backgroundSize: '22px 22px' }}
      />
      <div className="relative mx-auto flex max-w-5xl flex-col px-6 pb-20 pt-8">
        <nav className="flex items-center gap-2">
          <span className="h-8 w-8 rounded-lg" style={{ background: 'linear-gradient(135deg,#6d5efc,#20c4a8)' }} />
          <span className="text-[17px] font-bold tracking-tight">ScaleLab</span>
          <span className="ml-auto rounded-full border border-line-strong px-3 py-1 text-[12px] text-muted">Free · no login</span>
        </nav>

        <section className="mt-24 max-w-3xl">
          <h1 className="text-[44px] font-bold leading-[1.08] tracking-tight sm:text-[56px]">
            See how your system behaves <span className="text-accent-soft">before it goes live.</span>
          </h1>
          <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-muted">
            An interactive playground for application architecture. Build it on a canvas, flood it with traffic, and watch
            where it bends and breaks.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link
              href="/play?template=shopsphere"
              className="rounded-xl bg-accent px-5 py-3 text-[15px] font-semibold text-white transition hover:brightness-110"
            >
              ▶ Try the e-commerce example
            </Link>
            <Link
              href="/play?template=microservices"
              className="rounded-xl border border-line-strong bg-card px-5 py-3 text-[15px] transition hover:bg-raised"
            >
              Microservices + Kafka example
            </Link>
            <Link
              href="/play?template=checkout"
              className="rounded-xl border border-line-strong bg-card px-5 py-3 text-[15px] transition hover:bg-raised"
            >
              Checkout journey + Stripe
            </Link>
            <Link
              href="/play?template=blank"
              className="rounded-xl border border-line-strong bg-card px-5 py-3 text-[15px] transition hover:bg-raised"
            >
              Start from scratch
            </Link>
          </div>
        </section>

        <section className="mt-24 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s) => (
            <div key={s.n} className="rounded-2xl border border-line bg-panel/80 p-5">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-raised font-mono text-[13px] text-accent-soft">{s.n}</div>
              <h2 className="mt-3 text-[16px] font-semibold">{s.title}</h2>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">{s.text}</p>
            </div>
          ))}
        </section>

        <p className="mt-16 text-[12px] text-faint">
          Everything runs in your browser. Numbers are modeled estimates from your settings, not measurements of a real system.
        </p>
      </div>
    </main>
  );
}
