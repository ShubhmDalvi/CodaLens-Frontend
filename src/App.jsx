import React, { useEffect, useRef, useState } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import { Bar, Line, Doughnut } from "react-chartjs-2";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  ArcElement,
  Title,
  Tooltip,
  Legend
);

// ----------------- Config / Palette -----------------
const PALETTE = ["#00B8A9", "#F8F3D4", "#F6416C", "#FFDE7D"]; // teal, cream, pink, yellow
const CARD_BG = "#F8F3D4"; // soft card tint (cream)
const API_BASE = process.env.REACT_APP_API_URL || "http://localhost:8080";

// ----------------- Helpers -----------------
const rand = (min, max) => Math.random() * (max - min) + min;
function humanFileSize(bytes) {
  if (!bytes && bytes !== 0) return "";
  if (bytes === 0) return "0 B";
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const sizes = ["B", "KB", "MB", "GB"];
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${sizes[i]}`;
}
function isDarkish(hex) {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum < 160;
}

// ----------------- Chart plugins -----------------
const avgLinePlugin = {
  id: "avgLine",
  afterDraw(chart) {
    const { ctx, chartArea, scales } = chart;
    if (!chartArea) return;
    const { left, right } = chartArea;
    const yScale = scales.y;
    const values = chart.data.datasets[0]?.data || [];
    if (!values.length) return;
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const y = yScale.getPixelForValue(avg);
    ctx.save();
    ctx.beginPath();
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 1.0;
    ctx.strokeStyle = "rgba(0,0,0,0.18)";
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.font = "12px system-ui, Arial";
    const label = `Avg ${avg.toFixed(1)}`;
    ctx.fillText(label, right - ctx.measureText(label).width - 8, y - 8);
    ctx.restore();
  },
};

const centerTextPlugin = {
  id: "centerText",
  afterDraw(chart) {
    if (chart.config.type !== "doughnut") return;
    const { ctx, chartArea } = chart;
    const centerX = (chartArea.left + chartArea.right) / 2;
    const centerY = (chartArea.top + chartArea.bottom) / 2;
    const data = chart.data.datasets?.[0]?.data || [];
    const val = data[0] ?? null;
    ctx.save();
    ctx.fillStyle = "#222";
    ctx.font = "800 20px system-ui, Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(val !== null ? `${Math.round(val)}%` : "-", centerX, centerY - 6);
    ctx.font = "500 12px system-ui, Arial";
    ctx.fillText("Maintainability", centerX, centerY + 14);
    ctx.restore();
  },
};

// ----------------- App -----------------
export default function App() {
  // state
  const [file, setFile] = useState(null);
  const [fileSize, setFileSize] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [entered, setEntered] = useState(false);

  const inputRef = useRef(null);
  const bgRef = useRef(null);
  const canvasRef = useRef(null);
  const rafRef = useRef(null);

  // logo typography animation
  useEffect(() => {
    const el = document.getElementById("logo-text");
    if (!el) return;
    const text = el.textContent || "";
    el.innerHTML = "";
    const spans = [];
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const s = document.createElement("span");
      s.textContent = ch;
      s.style.display = "inline-block";
      s.style.opacity = "0";
      s.style.transform = "translateY(8px) scale(.98)";
      s.style.transition = `transform 520ms cubic-bezier(.22,.9,.32,1) ${i * 35}ms, opacity 420ms ${i * 35}ms`;
      if (ch === " ") s.style.marginRight = "6px";
      el.appendChild(s);
      spans.push(s);
    }
    requestAnimationFrame(() => {
      spans.forEach((s) => {
        s.style.opacity = "1";
        s.style.transform = "translateY(0) scale(1)";
      });
    });
    setTimeout(() => {
      spans.forEach((s, i) => {
        s.style.animation = `logo-breath 3600ms ease-in-out ${i * 10}ms infinite alternate`;
      });
      el.classList.add("logo-shimmer");
    }, spans.length * 35 + 200);
    return () => spans.forEach((s) => (s.style.animation = ""));
  }, []);

  // background animation (particle system)
  useEffect(() => {
    const container = bgRef.current;
    if (!container) return;
    const canvas = document.createElement("canvas");
    canvas.style.position = "fixed";
    canvas.style.inset = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.zIndex = "0";
    canvas.style.pointerEvents = "none";
    container.appendChild(canvas);
    canvasRef.current = canvas;
    const ctx = canvas.getContext("2d", { alpha: true });

    let w = window.innerWidth;
    let h = window.innerHeight;
    const dpr = Math.max(1, window.devicePixelRatio || 1);

    function resize() {
      w = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
      h = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener("resize", resize);

    const colors = ["rgba(0,184,169,0.6)", "rgba(246,65,108,0.6)", "rgba(255,222,125,0.6)"];
    class Particle {
      constructor() {
        this.x = Math.random() * w;
        this.y = Math.random() * h;
        this.size = Math.random() * 2 + 1;
        this.speedX = Math.random() * 1 - 0.5;
        this.speedY = Math.random() * 1 - 0.5;
        this.color = colors[Math.floor(Math.random() * colors.length)];
      }
      update() {
        this.x += this.speedX;
        this.y += this.speedY;
        if (this.x > w || this.x < 0) this.speedX = -this.speedX;
        if (this.y > h || this.y < 0) this.speedY = -this.speedY;
      }
      draw() {
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const particles = [];
    for (let i = 0; i < 100; i++) {
      particles.push(new Particle());
    }

    function dist(x1, y1, x2, y2) {
      return Math.hypot(x1 - x2, y1 - y2);
    }

    const prefersReduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function draw(now) {
      if (prefersReduced) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#f2f4ef";
        ctx.fillRect(0, 0, w, h);
        return;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // subtle base
      ctx.fillStyle = "rgba(248,243,212,0.7)";
      ctx.fillRect(0, 0, w, h);

      for (let p of particles) {
        p.update();
        p.draw();
      }

      // connect close particles
      ctx.lineWidth = 0.5;
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const d = dist(particles[i].x, particles[i].y, particles[j].x, particles[j].y);
          if (d < 120) {
            ctx.strokeStyle = `rgba(0,184,169,${(1 - d / 120) * 0.3})`;
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.stroke();
          }
        }
      }

      rafRef.current = requestAnimationFrame(draw);
    }
    rafRef.current = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener("resize", resize);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (canvas && container.contains(canvas)) container.removeChild(canvas);
    };
  }, []);

  // result animation
  useEffect(() => {
    if (result) setTimeout(() => setEntered(true), 12);
    else setEntered(false);
  }, [result]);

  // ---------- file & drag/drop ----------
  function handleChooseClick() {
    if (inputRef.current) {
      inputRef.current.value = null;
      inputRef.current.click();
    }
  }
  function onInputChange(e) {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setFileSize(f ? humanFileSize(f.size) : "");
    setError("");
    setResult(null);
  }
  function onDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const f = e.dataTransfer?.files?.[0] ?? null;
    if (f) {
      setFile(f);
      setFileSize(humanFileSize(f.size));
      setError("");
      setResult(null);
    }
  }
  function onDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  }
  function onDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  }

  // ---------- upload ----------
  async function upload() {
    setError("");
    setResult(null);
    if (!file) return setError("Please choose or drop a file first.");
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const url = (API_BASE || "") + "/api/v1/analyze";
      const res = await fetch(url, { method: "POST", body: fd });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`Server returned ${res.status}${txt ? ": " + txt : ""}`);
      }
      const json = await res.json();
      setResult(json);
    } catch (err) {
      const m = err?.message || String(err);
      if (m === "Failed to fetch") setError(`Failed to fetch. Is backend running and CORS enabled? (${API_BASE})`);
      else setError(m);
    } finally {
      setLoading(false);
    }
  }

  // ---------- chart data ----------
  const files = result?.files ?? [];
  const labels = files.map((f) => f.path);
  const cycloData = files.map((f) => f.cyclomatic ?? 0);
  const maintainData = files.map((f) => f.maintainabilityIndex ?? 0);

  // conditional colors (teal = good, yellow = medium, pink = bad)
  const barColors = cycloData.map((v) => {
    if (v <= 3) return PALETTE[0]; // teal
    if (v <= 8) return PALETTE[3]; // yellow
    return PALETTE[2]; // pink
  });

  const barData = {
    labels,
    datasets: [
      {
        label: "Cyclomatic",
        data: cycloData,
        backgroundColor: barColors,
        borderRadius: 8,
        barPercentage: 0.62,
        categoryPercentage: 0.72,
      },
    ],
  };

  const barOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      title: { display: true, text: "Cyclomatic Complexity per file" },
      tooltip: {
        enabled: true,
        backgroundColor: "#fff",
        titleColor: "#222",
        bodyColor: "#222",
        borderColor: "#ddd",
        borderWidth: 1,
        padding: 10,
        callbacks: {
          title: (items) => items[0].label,
          label: (ctx) => {
            const idx = ctx.dataIndex;
            const f = files[idx];
            if (!f) return `${ctx.dataset.label}: ${ctx.formattedValue}`;
            return [
              `Cyclomatic: ${f.cyclomatic}`,
              `Maintainability: ${f.maintainabilityIndex}`,
              `Lines: ${f.lines}`,
              `Halstead V: ${Number(f.halsteadVolume || 0).toFixed(1)}`,
            ];
          },
        },
      },
    },
    scales: {
      y: { beginAtZero: true, ticks: { precision: 0 } },
      x: { ticks: { maxRotation: 20, minRotation: 0 } },
    },
    animation: { duration: 700, easing: "cubicBezier(.22,.9,.32,1)" },
    plugins: [avgLinePlugin],
  };

  const lineData = {
    labels,
    datasets: [
      {
        label: "Maintainability",
        data: maintainData,
        borderColor: PALETTE[0],
        backgroundColor: "rgba(0,184,169,0.10)",
        tension: 0.36,
        fill: true,
        pointRadius: 4,
      },
    ],
  };
  const lineOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false }, title: { display: true, text: "Maintainability Index" } },
    scales: { y: { beginAtZero: false } },
    animation: { duration: 600 },
  };

  const avgMaintain = maintainData.length ? maintainData.reduce((a, b) => a + b, 0) / maintainData.length : 0;
  const donutData = {
    labels: ["Avg", "Remaining"],
    datasets: [
      {
        data: [Number(avgMaintain.toFixed(0)), Math.max(0, 100 - Math.round(avgMaintain))],
        backgroundColor: [PALETTE[0], "rgba(0,0,0,0.06)"],
        hoverOffset: 6,
      },
    ],
  };
  const donutOptions = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: "72%",
    plugins: { legend: { display: false } },
    animation: { duration: 700 },
    plugins: [centerTextPlugin],
  };

  // ---------- render ----------
  return (
    <div style={{ minHeight: "100vh", background: `linear-gradient(180deg, ${PALETTE[1]} 0%, #ECF7F3 100%)`, position: "relative", overflowX: "hidden", fontSize: 15 }}>
      <div ref={bgRef} style={{ position: "fixed", inset: 0, zIndex: 0 }} />

      <div style={{ position: "relative", zIndex: 2, maxWidth: 1200, margin: "28px auto", padding: "18px" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18, gap: 12 }}>
          <div>
            <h1 id="logo-text" style={{ margin: 0, fontSize: 38, fontWeight: 900, letterSpacing: "1px", fontFamily: "'Montserrat', system-ui, Arial", color: "#0f2b26" }}>
              CODALENS
            </h1>
            <div style={{ marginTop: 8, color: "#27413f", fontSize: 14 }}>Code complexity visualizer — analyze your Java project</div>
          </div>

          <div className="header-buttons" style={{ display: "flex", gap: 10 }}>
            <button onClick={() => window.location.reload()} style={buttonStyle(PALETTE[0])}>Refresh</button>
          </div>
        </header>

        <main style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 18 }}>
          <section style={{ padding: 16, borderRadius: 12, background: CARD_BG, border: "1px solid rgba(0,0,0,0.18)" }}>
            <h3 style={{ marginTop: 0, marginBottom: 6 }}>Upload Project</h3>
            <p style={{ marginTop: 0, marginBottom: 12, color: "#27413f", fontSize: 13 }}>Upload a .java file or a .zip containing a Java project. Drag & drop supported.</p>

            <input ref={inputRef} id="fileInput" type="file" accept=".java,application/zip" onChange={onInputChange} style={{ display: "none" }} />

            <div
              onClick={handleChooseClick}
              onDragOver={onDragOver}
              onDragEnter={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              style={{
                padding: 12,
                borderRadius: 10,
                background: "#fff",
                border: dragActive ? "2px dashed rgba(0,0,0,0.22)" : "1px solid rgba(0,0,0,0.18)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                transition: "box-shadow 140ms, transform 120ms",
                boxShadow: dragActive ? "0 10px 30px rgba(0,0,0,0.06)" : "none",
                marginBottom: 12,
              }}
            >
              <div style={{ fontWeight: file ? 700 : 500, color: "#16332f", fontSize: 15 }}>{file ? file.name : "Choose file or drop here..."}</div>
              <div style={{ color: "#666", fontSize: 13 }}>{fileSize || "ZIP or .java"}</div>
            </div>

            <div className="upload-buttons" style={{ display: "flex", gap: 10 }}>
              <button onClick={upload} disabled={loading} style={{ ...buttonStyle(PALETTE[0]), flex: 1 }}>{loading ? "Analyzing..." : "Analyze"}</button>
              <button onClick={() => { setFile(null); setFileSize(""); setResult(null); setError(""); if (inputRef.current) inputRef.current.value = null; }} style={buttonStyle(PALETTE[3])}>Reset</button>
            </div>

            {error && <div style={{ marginTop: 10, color: "#b30e0e", fontWeight: 600 }}>{error}</div>}

            <div style={{ marginTop: 12, color: "#27413f", fontSize: 13 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Tips:</div>
              <ul style={{ marginTop: 0 }}>
                <li>ZIP should contain .java files under any folder</li>
                <li>Large projects may take a few seconds</li>
              </ul>
            </div>
          </section>

          <section style={{ padding: 14, borderRadius: 12, background: CARD_BG, border: "1px solid rgba(0,0,0,0.18)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
              <h3 style={{ margin: 0 }}>Analysis</h3>
              <div style={{ color: "#27413f", fontSize: 14 }}>Total files: <strong>{result?.totalFiles ?? 0}</strong></div>
            </div>

            {!result && <div style={{ height: 220, display: "flex", alignItems: "center", justifyContent: "center", color: "#666" }}>No result yet — upload a file to begin</div>}

            {result && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
                  <div style={{ padding: 12, borderRadius: 10, background: "#fff", border: "1px solid rgba(0,0,0,0.12)", minHeight: 200 }}>
                    <div style={{ height: 180 }}>
                      <Bar data={barData} options={barOptions} plugins={[avgLinePlugin]} />
                    </div>
                  </div>

                  <div style={{ padding: 12, borderRadius: 10, background: "#fff", border: "1px solid rgba(0,0,0,0.12)", display: "flex", flexDirection: "column", gap: 12, minHeight: 200 }}>
                    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                      <div style={{ width: 140, height: 140 }}>
                        <Doughnut data={donutData} options={donutOptions} plugins={[centerTextPlugin]} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>Avg Maintainability</div>
                        <div style={{ color: "#5b5b57", marginTop: 8 }}>{avgMaintain ? avgMaintain.toFixed(1) : "-"} / 100</div>
                        <div style={{ marginTop: 10 }}>
                          <Line data={lineData} options={lineOptions} />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div style={{ gridColumn: "1 / -1", padding: 12, borderRadius: 10, background: "#fff", border: "1px solid rgba(0,0,0,0.12)" }}>
                    <h4 style={{ marginTop: 0 }}>Files</h4>
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                        <thead>
                          <tr style={{ textAlign: "left", color: "#16332f" }}>
                            <th style={{ padding: 10 }}>Path</th>
                            <th style={{ padding: 10 }}>Lines</th>
                            <th style={{ padding: 10 }}>Cyclomatic</th>
                            <th style={{ padding: 10 }}>Maintainability</th>
                            <th style={{ padding: 10 }}>Duplicates</th>
                          </tr>
                        </thead>
                        <tbody>
                          {files.map((f) => (
                            <tr key={f.path} style={{ borderTop: "1px solid rgba(0,0,0,0.04)" }}>
                              <td style={{ padding: 10 }}>{f.path}</td>
                              <td style={{ padding: 10 }}>{f.lines}</td>
                              <td style={{ padding: 10 }}>{f.cyclomatic}</td>
                              <td style={{ padding: 10 }}>{f.maintainabilityIndex}</td>
                              <td style={{ padding: 10 }}>{f.duplicatedWith?.length || 0}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </>
            )}
          </section>
        </main>

        <footer style={{ marginTop: 18, textAlign: "center", color: "#27413f" }}>Made with ❤️ — CODALENS</footer>
      </div>

      <style>{`
        /* logo and shimmer */
        @keyframes logo-breath { from { transform: translateY(0) scale(1); } to { transform: translateY(-2px) scale(1.02); } }
        .logo-shimmer {
          background: linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.45) 50%, rgba(255,255,255,0) 100%);
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          animation: shimmer 2.8s linear infinite;
        }
        @keyframes shimmer { 0% { background-position: -140% 0 } 100% { background-position: 140% 0 } }

        /* buttons */
        button { transition: transform .12s ease, box-shadow .12s ease, filter .12s ease; font-weight: 700; border-radius: 10px; padding: 8px 12px; border: 1px solid rgba(0,0,0,0.18); cursor: pointer; }
        button:focus { outline: 3px solid rgba(0,0,0,0.06); outline-offset: 2px; }
        button:hover { transform: translateY(-3px); box-shadow: 0 12px 26px rgba(0,0,0,0.08); }

        /* subtle file chooser hint (not bold) */
        .file-hint { font-size: 13px; font-weight: 500; color: #6b6b6b; }

        /* responsive layout */
        @media (max-width: 880px) {
          main { grid-template-columns: 1fr !important; }
        }
        @media (max-width: 520px) {
          h1#logo-text { font-size: 28px !important; }
          .upload-buttons { flex-direction: column; }
          .upload-buttons button { width: 100%; }
          .header-buttons { display: none; }
        }
      `}</style>
    </div>
  );
}

// ----------------- button style helper -----------------
function buttonStyle(color) {
  const darkText = "#18221f";
  const lightText = "#ffffff";
  const useLight = isDarkish(color);
  return {
    background: color,
    color: useLight ? lightText : darkText,
    border: "1px solid rgba(0,0,0,0.18)",
    borderRadius: 10,
    padding: "8px 12px",
    fontWeight: 700,
    cursor: "pointer",
  };
}