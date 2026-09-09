export const dynamic = "force-static";

const problems = [
  ["Fragmented operational information", "Daily production, breakdown, maintenance and machine-health information is often scattered across spreadsheets, messages and paper records."],
  ["Reactive maintenance", "Teams can lose valuable production time when faults are only addressed after equipment has already stopped."],
  ["Slow reporting", "Manual consolidation makes it difficult to see machine performance, recurring downtime and maintenance priorities quickly."],
  ["Limited decision visibility", "Without one clear operational picture, engineering and management decisions can be delayed or based on incomplete information."],
];

const capabilities = [
  ["Asset health tracking", "Creates a structured view of machine condition, operating status and reliability information."],
  ["Breakdown intelligence", "Records faults, downtime, causes and recurring patterns so teams can identify where production time is being lost."],
  ["Maintenance planning", "Supports service tracking and planned maintenance so work can move from reactive intervention toward prevention."],
  ["Production performance", "Brings operational production information together with equipment performance for clearer daily, weekly and monthly understanding."],
  ["KPI visibility", "Turns operating data into meaningful indicators such as availability, utilisation, downtime and performance trends."],
  ["Actionable reporting", "Transforms raw operational records into structured summaries, trends and decision-support information."],
];

export default function Home() {
  return (
    <main className="sas-site">
      <style>{`
        :root{--green:#006a45;--green2:#074d39;--gold:#eca900;--ink:#172026;--muted:#5d6870;--soft:#f4f7f5;--line:#dfe6e1}
        *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:#fff;color:var(--ink);font-family:Inter,Arial,sans-serif}
        .sas-site a{text-decoration:none}.wrap{width:min(1160px,calc(100% - 40px));margin:auto}
        header{position:sticky;top:0;z-index:40;background:rgba(255,255,255,.96);backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}
        .nav{height:78px;display:flex;align-items:center;justify-content:space-between;gap:26px}.brand{display:flex;align-items:center;gap:12px;color:var(--ink);font-weight:900;letter-spacing:.02em}.brand img{width:54px;height:54px;object-fit:contain}.brand span{font-size:15px}.navlinks{display:flex;gap:24px;align-items:center}.navlinks a{color:#263139;font-size:14px;font-weight:700}.navlinks a:hover{color:var(--green)}
        .cta{display:inline-flex;align-items:center;justify-content:center;background:var(--green);color:white!important;padding:12px 18px;border-radius:10px;font-weight:800;box-shadow:0 8px 22px rgba(0,106,69,.18)}
        .hero{background:linear-gradient(125deg,#f4faf7 0%,#fff 54%,#fff8e7 100%);padding:86px 0 74px;border-bottom:1px solid var(--line)}.hero-grid{display:grid;grid-template-columns:1.18fr .82fr;gap:64px;align-items:center}.eyebrow{font-size:12px;font-weight:900;letter-spacing:.2em;color:var(--green);text-transform:uppercase}.hero h1{font-size:clamp(42px,6vw,74px);line-height:.98;margin:18px 0 24px;letter-spacing:-.045em}.hero h1 em{font-style:normal;color:var(--green)}.lead{font-size:19px;line-height:1.7;color:var(--muted);max-width:760px}.hero-actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:30px}.ghost{display:inline-flex;padding:12px 18px;border:1px solid #cbd5cf;color:var(--ink);border-radius:10px;font-weight:800;background:white}.hero-card{background:white;border:1px solid var(--line);border-radius:24px;padding:34px;box-shadow:0 24px 70px rgba(26,44,35,.10)}.hero-card img{width:100%;max-height:280px;object-fit:contain}.motto{text-align:center;margin-top:16px;font-size:12px;letter-spacing:.26em;color:var(--green);font-weight:900}.mini{margin-top:26px;display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.mini div{padding:15px 12px;border-radius:12px;background:var(--soft);text-align:center;font-size:12px;font-weight:800;color:#34423a}
        section{padding:82px 0}.section-head{max-width:760px;margin-bottom:38px}.section-head h2{font-size:clamp(32px,4vw,48px);line-height:1.08;margin:10px 0 14px;letter-spacing:-.03em}.section-head p{font-size:17px;line-height:1.7;color:var(--muted)}.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:18px}.card{border:1px solid var(--line);border-radius:18px;padding:28px;background:white}.card .num{font-weight:900;color:var(--gold);font-size:13px;letter-spacing:.12em}.card h3{font-size:20px;margin:10px 0}.card p{margin:0;color:var(--muted);line-height:1.65}.soft{background:var(--soft)}
        .flow{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}.flow-card{position:relative;background:white;border:1px solid var(--line);border-radius:18px;padding:24px}.flow-card b{display:block;color:var(--green);font-size:14px;margin-bottom:8px}.flow-card span{font-size:14px;line-height:1.55;color:var(--muted)}
        .cap-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}.cap{padding:26px;border-radius:18px;border:1px solid var(--line);background:#fff}.icon{width:38px;height:38px;border-radius:10px;background:#e7f3ed;display:flex;align-items:center;justify-content:center;color:var(--green);font-weight:900}.cap h3{margin:16px 0 8px;font-size:18px}.cap p{margin:0;line-height:1.6;color:var(--muted);font-size:14px}
        .founder{display:grid;grid-template-columns:.75fr 1.25fr;gap:42px;align-items:center}.founder-badge{background:linear-gradient(145deg,#0a694b,#063d2e);border-radius:24px;padding:42px;color:white;min-height:330px;display:flex;flex-direction:column;justify-content:space-between}.founder-badge img{width:130px;background:white;border-radius:18px;padding:8px}.founder-badge strong{font-size:28px;line-height:1.1}.founder-copy p{font-size:17px;line-height:1.8;color:var(--muted)}
        .contact{background:#101a17;color:white}.contact .section-head p{color:#c9d3cf}.contact-box{display:flex;justify-content:space-between;align-items:center;gap:30px;padding:32px;border:1px solid rgba(255,255,255,.14);border-radius:20px;background:rgba(255,255,255,.04)}.contact-box h3{margin:0 0 8px;font-size:22px}.contact-box p{margin:0;color:#cbd5d1}.contact-box .cta{background:var(--gold);color:#172026!important}
        footer{background:#0b1210;color:#aebbb6;border-top:1px solid rgba(255,255,255,.08);padding:26px 0}.foot{display:flex;justify-content:space-between;gap:20px;font-size:13px}.foot strong{color:white}
        @media(max-width:900px){.hero-grid,.founder{grid-template-columns:1fr}.cap-grid{grid-template-columns:1fr 1fr}.flow{grid-template-columns:1fr 1fr}.navlinks a:not(.cta){display:none}.hero{padding-top:56px}}
        @media(max-width:620px){.wrap{width:min(100% - 26px,1160px)}.nav{height:70px}.brand span{display:none}.hero h1{font-size:44px}.grid,.cap-grid,.flow,.mini{grid-template-columns:1fr}.contact-box,.foot{align-items:flex-start;flex-direction:column}.hero-card{padding:22px}section{padding:60px 0}}
      `}</style>

      <header>
        <div className="wrap nav">
          <a className="brand" href="#home"><img src="/sindane-logo.png" alt="Sindane Asset Solutions logo"/><span>SINDANE ASSET SOLUTIONS</span></a>
          <nav className="navlinks" aria-label="Primary navigation">
            <a href="#about">About</a><a href="#problem">The Problem</a><a href="#solution">Solution</a><a href="#founder">Founder</a><a className="cta" href="#contact">Contact</a>
          </nav>
        </div>
      </header>

      <section className="hero" id="home">
        <div className="wrap hero-grid">
          <div>
            <div className="eyebrow">Engineering • Technology • Mining Solutions</div>
            <h1>Turning mining information into <em>better decisions.</em></h1>
            <p className="lead">Sindane Asset Solutions develops practical engineering and digital solutions for mining operations. Our focus is simple: understand operational problems, structure the information behind them, and create tools that help teams track equipment, prevent avoidable downtime and improve performance.</p>
            <div className="hero-actions"><a className="cta" href="#solution">See how it works</a><a className="ghost" href="#about">Our background</a></div>
          </div>
          <div className="hero-card"><img src="/sindane-logo.png" alt="Sindane Asset Solutions — Track Prevent Perform"/><div className="motto">TRACK · PREVENT · PERFORM</div><div className="mini"><div>Engineering insight</div><div>Operational visibility</div><div>Practical solutions</div></div></div>
        </div>
      </section>

      <section id="about">
        <div className="wrap"><div className="section-head"><div className="eyebrow">Background</div><h2>Built from real operational challenges.</h2><p>Sindane Asset Solutions was created around a recurring mining challenge: important engineering and production information exists, but it is often difficult to bring that information together quickly enough to support decisions. The business focuses on closing that gap by combining engineering thinking, practical problem-solving and digital systems.</p></div>
          <div className="grid"><div className="card"><div className="num">01 / OBSERVE</div><h3>Start with the actual operational problem</h3><p>We look at how work is currently recorded, where time is lost, what information is missing and which repetitive tasks can be improved.</p></div><div className="card"><div className="num">02 / ENGINEER</div><h3>Turn the problem into a structured solution</h3><p>We translate day-to-day challenges into clear workflows, calculations, tracking systems, dashboards and decision-support tools.</p></div></div>
        </div>
      </section>

      <section className="soft" id="problem"><div className="wrap"><div className="section-head"><div className="eyebrow">Mining Problems We Address</div><h2>Better visibility before problems become expensive.</h2><p>Mining equipment performance affects production, maintenance cost and operational planning. When information is delayed or fragmented, small issues can grow into lost hours, repeated failures and slow decisions.</p></div><div className="grid">{problems.map((p,i)=><div className="card" key={p[0]}><div className="num">0{i+1}</div><h3>{p[0]}</h3><p>{p[1]}</p></div>)}</div></div></section>

      <section id="solution"><div className="wrap"><div className="section-head"><div className="eyebrow">How The Solution Works</div><h2>From operational data to engineering action.</h2><p>The approach is designed to make operational information easier to capture, understand and use. It does not replace engineering judgement; it gives engineers and decision-makers a clearer evidence base.</p></div><div className="flow"><div className="flow-card"><b>1. CAPTURE</b><span>Record production, equipment condition, downtime, maintenance and relevant operating information.</span></div><div className="flow-card"><b>2. STRUCTURE</b><span>Organise the information into a consistent digital format instead of isolated records.</span></div><div className="flow-card"><b>3. ANALYSE</b><span>Calculate trends, KPIs, repeated failures and performance patterns.</span></div><div className="flow-card"><b>4. ACT</b><span>Use the results to prioritise maintenance, investigate root causes and support operational decisions.</span></div></div></div></section>

      <section className="soft"><div className="wrap"><div className="section-head"><div className="eyebrow">What It Does</div><h2>TMM Asset Health</h2><p>Our flagship digital solution brings machine health, breakdown, maintenance and production information into a clearer operational picture. It is being developed as a practical asset-performance platform shaped around the needs of mining equipment and engineering teams.</p></div><div className="cap-grid">{capabilities.map((c,i)=><div className="cap" key={c[0]}><div className="icon">{String(i+1).padStart(2,"0")}</div><h3>{c[0]}</h3><p>{c[1]}</p></div>)}</div></div></section>

      <section id="founder"><div className="wrap founder"><div className="founder-badge"><img src="/sindane-logo.png" alt="Sindane Asset Solutions"/><div><div style={{fontSize:12,letterSpacing:".16em",opacity:.8,marginBottom:10}}>FOUNDER & CEO</div><strong>Mandlenkosi Elton Sindane</strong></div></div><div className="founder-copy"><div className="eyebrow">Leadership</div><h2 style={{fontSize:"clamp(32px,4vw,48px)",margin:"10px 0 18px",letterSpacing:"-.03em"}}>Engineering problems deserve practical solutions.</h2><p>Mandlenkosi Elton Sindane founded Sindane Asset Solutions with a focus on solving real industrial problems through engineering analysis, operational understanding and technology. The company’s work is driven by the idea that better systems should reduce repetitive work, reveal the causes behind poor performance and help technical teams make faster, more informed decisions.</p><p>The long-term vision is to develop engineering solutions that are practical enough for day-to-day operations and strong enough to support the future of data-driven mining.</p></div></div></section>

      <section className="contact" id="contact"><div className="wrap"><div className="section-head"><div className="eyebrow" style={{color:"#f2b300"}}>Sindane Asset Solutions</div><h2>Let’s solve the next mining problem.</h2><p>For engineering solutions, technology demonstrations, collaboration or business enquiries, contact Sindane Asset Solutions.</p></div><div className="contact-box"><div><h3>Track. Prevent. Perform.</h3><p>Engineering and digital solutions for mining performance.</p></div><a className="cta" href="mailto:info@sindaneassetsolutions.co.za">info@sindaneassetsolutions.co.za</a></div></div></section>
      <footer><div className="wrap foot"><div><strong>Sindane Asset Solutions</strong> · South Africa</div><div>© 2026 Sindane Asset Solutions. All rights reserved.</div></div></footer>
    </main>
  );
}
