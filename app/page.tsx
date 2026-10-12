export const dynamic = "force-static";

const problems = [
  "Production and breakdown information is scattered across spreadsheets, paper records and messages.",
  "Engineers spend hours combining reports before they can analyse performance.",
  "Machines experience repeated failures, but the history is difficult to trace.",
  "Missing daily reports leave gaps in the operational picture.",
  "Management receives figures without clear trends or explanations.",
];
const capabilities = [
  ["Keep fleet records together", "Capture production, operating hours and breakdown details in one system, making information easier to find and review."],
  ["Understand downtime", "Record when breakdowns start and end, along with their causes. Use downtime analysis and Pareto charts to see which problems account for the most lost time."],
  ["Prepare reports with less manual work", "Bring daily information into weekly and monthly summaries, with graphs showing availability, utilisation and performance trends."],
  ["Identify recurring problems", "Review equipment breakdown history to support investigations and maintenance planning."],
  ["Keep reporting on track", "Missing-report reminders help teams follow up on outstanding daily submissions."],
  ["Give each team member a clear role", "Admins capture and manage records. Engineers analyse performance and add comments to support operational decisions."],
];
const demoUrl = "https://wa.me/27661126886?text=Hello%2C%20I%20would%20like%20to%20book%20a%20TMM%20Asset%20Health%20demo.";
const pilotUrl = "mailto:mandlenkosisindane43@gmail.com?subject=TMM%20Asset%20Health%20Fleet%20Pilot";

export default function Home() {
  return (
    <main className="sas-site">
      <style>{`
        :root{--green:#006a45;--green2:#074d39;--gold:#eca900;--ink:#172026;--muted:#5d6870;--soft:#f4f7f5;--line:#dfe6e1}
        *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:#fff;color:var(--ink);font-family:Inter,Arial,sans-serif}
        .sas-site a{text-decoration:none}.sas-site section{scroll-margin-top:80px}.contact-email{overflow-wrap:anywhere}.problem-list{margin:0;padding-left:24px;display:grid;gap:20px;font-size:18px;line-height:1.65}.sas-site a:focus-visible{outline:3px solid var(--gold);outline-offset:4px}.wrap{width:min(1160px,calc(100% - 40px));margin:auto}
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

      <header><div className="wrap nav">
        <a className="brand" href="#home"><img src="/sindane-logo.png" alt="Sindane Asset Solutions logo"/><span>SINDANE ASSET SOLUTIONS</span></a>
        <nav className="navlinks" aria-label="Primary navigation"><a href="#problem">The Problems</a><a href="#solution">How It Helps</a><a href="#about">Our Experience</a><a className="cta" href="#contact">Book a Demo</a></nav>
      </div></header>
      <section className="hero" id="home"><div className="wrap hero-grid"><div>
        <div className="eyebrow">TMM Asset Health</div>
        <h1>Understand what is stopping your fleet—and <em>where to take action</em></h1>
        <p className="lead">TMM Asset Health by Sindane Asset Solutions helps mines and contractors track daily production, equipment breakdowns, availability and utilisation in one place.</p>
        <p className="lead">Turn daily fleet records into clear reports that help your team investigate downtime, identify recurring problems and prioritise maintenance.</p>
        <div className="hero-actions"><a className="cta" href={demoUrl}>Book a Demo</a><a className="ghost" href={pilotUrl}>Discuss a Fleet Pilot</a></div>
      </div><div className="hero-card"><img src="/sindane-logo.png" alt="Sindane Asset Solutions — Track Prevent Perform"/><div className="motto">TRACK · PREVENT · PERFORM</div><div className="mini"><div>Track production</div><div>Understand downtime</div><div>Simplify reporting</div></div></div></div></section>
      <section className="soft" id="problem"><div className="wrap"><div className="section-head"><h2>Is your team facing these problems?</h2></div><ul className="problem-list">{problems.map(problem => <li key={problem}>{problem}</li>)}</ul></div></section>
      <section id="solution"><div className="wrap"><div className="section-head"><h2>How TMM Asset Health makes the work easier</h2></div><div className="cap-grid">{capabilities.map(([title, description], i) => <div className="cap" key={title}><div className="icon" aria-hidden="true">{String(i + 1).padStart(2, "0")}</div><h3>{title}</h3><p>{description}</p></div>)}</div></div></section>
      <section className="soft" id="about"><div className="wrap"><div className="section-head"><h2>Built from practical mining reporting experience</h2><p>TMM Asset Health grew from reporting work at Northern Coal and has been tested by MSV contractor using its fleet data.</p></div></div></section>
      <section className="contact" id="contact"><div className="wrap"><div className="section-head"><h2>See how it could support your operation</h2><p>Book a short demonstration to explore your reporting challenges and discuss a pilot for your fleet.</p></div><div className="contact-box"><div><h3>Sindane Asset Solutions</h3><p>Phone / WhatsApp: <a style={{color:"white"}} href="tel:+27661126886">066 112 6886</a></p><p className="contact-email">Email: <a style={{color:"white"}} href="mailto:mandlenkosisindane43@gmail.com">mandlenkosisindane43@gmail.com</a></p></div><div className="hero-actions" style={{marginTop:0}}><a className="cta" href={demoUrl}>Book a Demo</a><a className="ghost" href={pilotUrl}>Discuss a Fleet Pilot</a></div></div></div></section>
      <footer><div className="wrap foot"><div><strong>Sindane Asset Solutions</strong> · South Africa</div><div>© 2026 Sindane Asset Solutions. All rights reserved.</div></div></footer>
    </main>
  );
}
