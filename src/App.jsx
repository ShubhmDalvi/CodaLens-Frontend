// App.jsx
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
const PALETTE = {
  teal: "#00B8A9",
  cream: "#F8F3D4",
  pink: "#F6416C",
  yellow: "#FFDE7D",
  ink: "#16332f",
  muted: "#6b6b6b",
};
const CARD_BG = PALETTE.cream; // soft card tint (cream)
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
function shortenPath(path) {
  const parts = path.split("/");
  if (parts.length > 1) {
    const filename = parts.pop();
    return filename.length > 22 ? filename.substring(0, 19) + "..." : filename;
  }
  return path;
}

// aggregate into bins of size `binSize` and compute averages
function aggregateIntoBins(files, binSize = 20) {
  if (!files.length) return { labels: [], cyclo: [], maintain: [], mapping: [] };
  const groups = [];
  for (let i = 0; i < files.length; i += binSize) {
    groups.push(files.slice(i, i + binSize));
  }
  const labels = groups.map((g, idx) => {
    const start = idx * binSize + 1;
    const end = idx * binSize + g.length;
    return `${start}–${end}`;
  });
  const cyclo = groups.map((g) =>
    Math.round((g.reduce((a, b) => a + (b.cyclomatic || 0), 0) / g.length) * 10) / 10
  );
  const maintain = groups.map((g) =>
    Math.round((g.reduce((a, b) => a + (b.maintainabilityIndex || 0), 0) / g.length) * 10) / 10
  );
  const mapping = groups.map((g) => g.map((f) => f.path));
  return { labels, cyclo, maintain, mapping };
}

// smooth color ramp between 3 colors based on value -> returns hex
function rampColor(value, min, mid, max) {
  const norm = Math.max(0, Math.min(1, (value - min) / (max - min || 1)));
  if (norm < 0.5) {
    const t = norm / 0.5;
    return blendHex(PALETTE.teal, PALETTE.yellow, t);
  } else {
    const t = (norm - 0.5) / 0.5;
    return blendHex(PALETTE.yellow, PALETTE.pink, t);
  }
}
function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return [r, g, b];
}
function blendHex(a, b, t) {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `rgb(${r}, ${g}, ${bl})`;
}

// ----------------- Chart plugins -----------------
// UPDATED: avgLinePlugin - draws dashed line always, but only shows text when avg is meaningful (>1.5).
const avgLinePlugin = {
  id: "avgLine",
  afterDraw(chart) {
    const { ctx, chartArea, scales } = chart;
    if (!chartArea) return;
    const { left, right } = chartArea;
    // pick first dataset numeric values (safeguard)
    const values = chart.data.datasets?.[0]?.data ?? [];
    if (!values || !values.length) return;
    const avg = values.reduce((a, b) => a + (Number(b) || 0), 0) / values.length;
    const yScale = scales?.y;
    if (!yScale) return;
    const y = yScale.getPixelForValue(avg);
    ctx.save();
    ctx.beginPath();
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(0,0,0,0.10)";
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();
    // show label only if avg is reasonably informative (not tiny like 1.0 for metrics that range 0..1)
    // here threshold 1.5: if avg <=1.5 we omit rendering text (keeps visual clean)
    if (avg > 1.5) {
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.font = "12px system-ui, Arial";
      const label = `Avg ${avg.toFixed(avg >= 10 ? 1 : 1)}`;
      ctx.fillText(label, right - ctx.measureText(label).width - 8, y - 8);
    }
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
    ctx.fillStyle = PALETTE.ink;
    ctx.font = "700 20px system-ui, Arial";
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

  // controls
  const [topN, setTopN] = useState(20); // options: 5,10,20,50,"all"
  const [showAllAggregatedBinSize, setShowAllAggregatedBinSize] = useState(20);
  const [searchQ, setSearchQ] = useState("");

  // modal for clicked bar / group
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState("");
  const [modalPaths, setModalPaths] = useState([]);

  const inputRef = useRef(null);
  const bgRef = useRef(null);
  const chartBarRef = useRef(null);
  const chartLineRef = useRef(null);
  const rafRef = useRef(null);

  // logo animation (unchanged)
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

  // subtle animated background (unchanged)
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

    const colors = ["rgba(0,184,169,0.22)", "rgba(246,65,108,0.16)", "rgba(255,222,125,0.16)"];
    class Particle {
      constructor() {
        this.x = Math.random() * w;
        this.y = Math.random() * h;
        this.size = Math.random() * 2 + 1;
        this.speedX = Math.random() * 0.6 - 0.3;
        this.speedY = Math.random() * 0.6 - 0.3;
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
    for (let i = 0; i < 70; i++) {
      particles.push(new Particle());
    }

    const prefersReduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function draw() {
      if (prefersReduced) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#f2f4ef";
        ctx.fillRect(0, 0, w, h);
        return;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "rgba(248,243,212,0.82)";
      ctx.fillRect(0, 0, w, h);

      for (let p of particles) {
        p.update();
        p.draw();
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
      // ensure topN reasonable when result changes
      // normalize topN to one of the select options (5,10,20,50) or "all"
setTopN((prev) => {
  if (prev === "all") return "all";
  const total = json?.totalFiles ?? (json?.files?.length ?? 0);
  const opts = [5, 10, 20, 50];
  const desired = Math.min(prev || 20, Math.max(5, Math.min(50, total || prev || 20)));
  let found = opts.find((o) => o === desired);
  if (!found) {
    found = opts.reduce((a, b) => (Math.abs(b - desired) < Math.abs(a - desired) ? b : a), opts[0]);
  }
  return found;
});

    } catch (err) {
      const m = err?.message || String(err);
      if (m === "Failed to fetch")
        setError(`Failed to fetch. Is backend running and CORS enabled? (${API_BASE})`);
      else setError(m);
    } finally {
      setLoading(false);
    }
  }

  // ---------- chart data ----------
  const files = result?.files ?? [];

  // allow search filtering
  const filteredFiles =
    searchQ && searchQ.trim()
      ? files.filter((f) => f.path.toLowerCase().includes(searchQ.trim().toLowerCase()))
      : files;

  const sortedFiles = [...filteredFiles].sort((a, b) => b.cyclomatic - a.cyclomatic);

  // build display set according to topN / aggregation
  const totalFiles = sortedFiles.length;
  let displayFiles = [];
  let agg = null;
  if (topN === "all") {
    if (totalFiles <= 60) {
      displayFiles = sortedFiles;
    } else {
      // large: aggregate into bins
      agg = aggregateIntoBins(sortedFiles, showAllAggregatedBinSize);
    }
  } else {
    const n = Number(topN) || 20;
    displayFiles = sortedFiles.slice(0, n);
  }

  // labels & numeric arrays used by charts:
  let labels = [];
  let cycloData = [];
  let maintainData = [];
  // mapping for tooltip / table references when aggregated
  let labelToPaths = {};

  if (agg) {
    labels = agg.labels;
    cycloData = agg.cyclo;
    maintainData = agg.maintain;
    agg.mapping.forEach((m, idx) => (labelToPaths[agg.labels[idx]] = m));
  } else {
    labels = displayFiles.map((f) => shortenPath(f.path));
    cycloData = displayFiles.map((f) => f.cyclomatic ?? 0);
    maintainData = displayFiles.map((f) => f.maintainabilityIndex ?? 0);
    displayFiles.forEach((f, idx) => (labelToPaths[labels[idx]] = [f.path]));
  }

  // determine min/max for ramp coloring
  const maxCyclo = Math.max(1, ...cycloData);
  const minCyclo = Math.min(0, ...cycloData);

  // conditional colors (smooth ramp)
  const barColors = cycloData.map((v) => rampColor(v, minCyclo, (minCyclo + maxCyclo) / 2, maxCyclo));
  const barBGs = barColors.map((c) => {
    // subtle gradient-ish using rgba version
    return c.replace("rgb(", "rgba(").replace(")", ",0.85)");
  });

  // change to horizontal bar when too many labels or labels long
  const forceHorizontal = labels.length > 14 || labels.some((l) => l.length > 20);

  // create bar data
  const barData = {
    labels,
    datasets: [
      {
        label: "Cyclomatic",
        data: cycloData,
        backgroundColor: barBGs,
        borderColor: barColors,
        borderWidth: 1,
        borderRadius: 8,
        barPercentage: 0.68,
        categoryPercentage: 0.72,
      },
    ],
  };

  // -------------------- IMPORTANT CHANGES: axis tick sampling & label callbacks --------------------
  // For vertical bars: sample x-axis ticks (show at most ~12 labels), use shorter labels, show full path in tooltip.
  // For horizontal bars: use autoSkip on y-axis ticks.
  const barOptions = {
    indexAxis: forceHorizontal ? "y" : "x",
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      title: {
        display: true,
        text: "Cyclomatic Complexity per file",
        font: { size: 14, weight: 700 },
      },
      tooltip: {
        enabled: true,
        backgroundColor: "#fff",
        titleColor: "#222",
        bodyColor: "#222",
        borderColor: "rgba(0,0,0,0.08)",
        borderWidth: 1,
        padding: 10,
        boxPadding: 4,
        callbacks: {
          // show full paths in tooltip title (handles aggregated groups too)
          title: (items) => {
            const label = items[0].label;
            const mapped = labelToPaths[label] || [];
            if (mapped.length > 1) {
              return `${mapped.length} files — ${mapped.slice(0, 8).join(", ")}${mapped.length > 8 ? "…" : ""}`;
            }
            // mapped[0] exists for single files
            return mapped[0] || label;
          },
          label: (ctx) => {
            const val = ctx.raw;
            return `${ctx.dataset.label}: ${val}`;
          },
        },
      },
    },
    scales: {
      y: forceHorizontal
        ? { ticks: { autoSkip: true, maxRotation: 0, font: { size: 12 }, color: PALETTE.ink } }
        : { beginAtZero: true, ticks: { precision: 0, color: PALETTE.ink } },
      x: forceHorizontal
        ? { beginAtZero: true, ticks: { color: PALETTE.ink } }
        : {
            ticks: {
              // show at most ~12 labels for vertical bars to avoid overlap; other ticks are blank
              callback: function (value, index, ticks) {
                const total = this.chart.data.labels.length;
                const maxShown = 12;
                const step = Math.ceil(Math.max(1, total / maxShown));
                if (index % step === 0) {
                  // show shortened label (already shortened by shortenPath) but ensure it's not too long
                  const label = this.chart.data.labels[index] || "";
                  return label.length > 18 ? label.substring(0, 16) + "…" : label;
                }
                return ""; // skip showing this tick
              },
              maxRotation: 45,
              minRotation: 45,
              autoSkip: false,
              font: { size: 12 },
              color: PALETTE.ink,
            },
            grid: { display: true, color: "rgba(0,0,0,0.04)" },
          },
    },
    animation: { duration: 600, easing: "cubic-bezier(.22,.9,.32,1)" },
    layout: { padding: { bottom: 12, left: 8, right: 8 } },
  };

  // line chart (Maintainability) - reduce x-axis clutter by sampling ticks and showing full path in tooltip
  const lineData = {
    labels,
    datasets: [
      {
        label: "Maintainability",
        data: maintainData,
        borderColor: PALETTE.teal,
        backgroundColor: "rgba(0,184,169,0.07)",
        tension: 0.32,
        fill: true,
        pointRadius: labels.length > 30 ? 0 : 4,
        pointHoverRadius: 6,
        pointBackgroundColor: PALETTE.teal,
      },
    ],
  };

  const lineOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      title: { display: true, text: "Maintainability Index", font: { size: 14, weight: 700 } },
      tooltip: {
        callbacks: {
          // show full path in title
          title: (items) => {
            const label = items[0].label;
            const mapped = labelToPaths[label] || [];
            return mapped.length > 1 ? `${mapped.length} files` : mapped[0] || label;
          },
          label: (ctx) => `Score: ${ctx.formattedValue}`,
        },
      },
    },
    scales: {
      y: { beginAtZero: false, ticks: { color: PALETTE.ink } },
      x: {
        ticks: {
          // show only a handful of labels for readability
          callback: function (value, index, ticks) {
            const total = this.chart.data.labels.length;
            const maxShown = 8;
            const step = Math.ceil(Math.max(1, total / maxShown));
            if (index % step === 0) {
              const label = this.chart.data.labels[index] || "";
              return label.length > 14 ? label.substring(0, 12) + "…" : label;
            }
            return "";
          },
          autoSkip: false,
          maxRotation: 35,
          minRotation: 0,
          color: PALETTE.ink,
        },
        grid: { display: false },
      },
    },
    animation: { duration: 600 },
  };

  const avgMaintain =
    (maintainData.length ? maintainData.reduce((a, b) => a + b, 0) / maintainData.length : 0) || 0;
  const donutData = {
    labels: ["Avg", "Remaining"],
    datasets: [
      {
        data: [Number(avgMaintain.toFixed(0)), Math.max(0, 100 - Math.round(avgMaintain))],
        backgroundColor: [PALETTE.teal, "rgba(0,0,0,0.06)"],
        hoverOffset: 6,
      },
    ],
  };
  const donutOptions = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: "68%",
    plugins: { legend: { display: false } },
    animation: { duration: 600 },
  };

  // chartHeight based on number of displayed items
  const itemCount = labels.length || 1;
  const baseHeight = 240;
  const perItem = forceHorizontal ? 22 : 16;
  const chartHeight = Math.min(1200, Math.max(baseHeight, Math.ceil(itemCount * perItem) + 120));
  const tableMaxHeight = Math.min(900, 160 + Math.min(700, totalFiles * 26));

  // ---------- interactions ----------
  function openModalForLabel(label) {
    const mapped = labelToPaths[label] || [];
    setModalTitle(label.includes("–") ? `Group ${label}` : label);
    setModalPaths(mapped);
    setModalOpen(true);
  }

  function handleBarClick(evt, elements) {
    if (!elements || !elements.length) return;
    const el = elements[0];
    const idx = el.index;
    const label = barData.labels[idx];
    openModalForLabel(label);
  }

  function handleLineClick(evt, elements) {
    if (!elements || !elements.length) return;
    const el = elements[0];
    const idx = el.index;
    const label = lineData.labels[idx];
    openModalForLabel(label);
  }

  // ---------- render ----------
  return (
    <div
      style={{
        minHeight: "100vh",
        background: `linear-gradient(180deg, ${CARD_BG} 0%, #ECF7F3 100%)`,
        position: "relative",
        overflowX: "hidden",
        fontSize: 15,
      }}
    >
      <div ref={bgRef} style={{ position: "fixed", inset: 0, zIndex: 0 }} />

      <div style={{ position: "relative", zIndex: 2, maxWidth: 1220, margin: "28px auto", padding: "18px" }}>
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 18,
            gap: 12,
          }}
        >
          <div>
            <h1
              id="logo-text"
              style={{
                margin: 0,
                fontSize: 38,
                fontWeight: 900,
                letterSpacing: "1px",
                fontFamily: "'Montserrat', system-ui, Arial",
                color: PALETTE.ink,
              }}
            >
              CODALENS
            </h1>
            <div style={{ marginTop: 8, color: "#27413f", fontSize: 14 }}>
              Code complexity visualizer — analyze your Java project
            </div>
          </div>

          <div className="header-buttons" style={{ display: "flex", gap: 10 }}>
            <button onClick={() => window.location.reload()} style={buttonStyle(PALETTE.teal)}>
              Refresh
            </button>
          </div>
        </header>

        <main style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 18 }}>
          <section
            style={{
              padding: 16,
              borderRadius: 12,
              background: CARD_BG,
              border: "1px solid rgba(0,0,0,0.08)",
            }}
          >
            <h3 style={{ marginTop: 0, marginBottom: 6 }}>Upload Project</h3>
            <p style={{ marginTop: 0, marginBottom: 12, color: PALETTE.ink, fontSize: 13 }}>
              Upload a .java file or a .zip containing a Java project. Drag & drop supported.
            </p>

            <input
              ref={inputRef}
              id="fileInput"
              type="file"
              accept=".java,application/zip"
              onChange={onInputChange}
              style={{ display: "none" }}
            />

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
                border: dragActive ? "2px dashed rgba(0,0,0,0.12)" : "1px solid rgba(0,0,0,0.08)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                transition: "box-shadow 140ms, transform 120ms",
                boxShadow: dragActive ? "0 10px 30px rgba(0,0,0,0.06)" : "none",
                marginBottom: 12,
              }}
            >
              <div
                style={{
                  fontWeight: file ? 700 : 600,
                  color: PALETTE.ink,
                  fontSize: 15,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  flex: 1,
                }}
              >
                {file ? file.name : "Choose file or drop here..."}
              </div>
              <div style={{ color: PALETTE.muted, fontSize: 13, flexShrink: 0, marginLeft: 8 }}>{fileSize || "ZIP or .java"}</div>
            </div>

            <div className="upload-buttons" style={{ display: "flex", gap: 10 }}>
              <button onClick={upload} disabled={loading} style={{ ...buttonStyle(PALETTE.teal), flex: 1 }}>
                {loading ? "Analyzing..." : "Analyze"}
              </button>
              <button
                onClick={() => {
                  setFile(null);
                  setFileSize("");
                  setResult(null);
                  setError("");
                  setSearchQ("");
                  if (inputRef.current) inputRef.current.value = null;
                }}
                style={buttonStyle(PALETTE.yellow)}
              >
                Reset
              </button>
            </div>

            {error && (
              <div style={{ marginTop: 10, color: "#b30e0e", fontWeight: 600 }}>
                {error}
              </div>
            )}

            <div style={{ marginTop: 12, color: PALETTE.ink, fontSize: 13 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Tips:</div>
              <ul style={{ marginTop: 0 }}>
                <li>ZIP should contain .java files under any folder</li>
                <li>Large projects may take a few seconds</li>
              </ul>
            </div>
          </section>

          <section
            style={{
              padding: 14,
              borderRadius: 12,
              background: CARD_BG,
              border: "1px solid rgba(0,0,0,0.08)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
              <h3 style={{ margin: 0 }}>Analysis</h3>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ color: PALETTE.ink, fontSize: 14 }}>
                  Total files: <strong>{result?.totalFiles ?? totalFiles}</strong>
                </div>

                {/* Top N selector */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    background: "#fff",
                    padding: 8,
                    borderRadius: 8,
                    border: "1px solid rgba(0,0,0,0.04)",
                  }}
                >
                  <label style={{ fontSize: 13, color: PALETTE.ink, fontWeight: 700 }}>View:</label>
                  <select
                    value={topN}
                    onChange={(e) => setTopN(e.target.value === "all" ? "all" : Number(e.target.value))}
                    style={{ padding: "6px 8px", borderRadius: 6 }}
                  >
                    <option value={5}>Top 5</option>
                    <option value={10}>Top 10</option>
                    <option value={20}>Top 20</option>
                    <option value={50}>Top 50</option>
                    <option value={"all"}>All</option>
                  </select>
                </div>

                {topN === "all" && totalFiles > 60 && (
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                      background: "#fff",
                      padding: 8,
                      borderRadius: 8,
                      border: "1px solid rgba(0,0,0,0.04)",
                    }}
                  >
                    <label style={{ fontSize: 13, fontWeight: 700 }}>Bin</label>
                    <select
                      value={showAllAggregatedBinSize}
                      onChange={(e) => setShowAllAggregatedBinSize(Number(e.target.value))}
                      style={{ padding: "6px 8px", borderRadius: 6 }}
                    >
                      <option value={10}>10</option>
                      <option value={20}>20</option>
                      <option value={50}>50</option>
                    </select>
                    <div style={{ fontSize: 12, color: PALETTE.muted }}>(aggregated groups)</div>
                  </div>
                )}
              </div>
            </div>

            <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center" }}>
              <input
                placeholder="Search files (path or filename)..."
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                style={{
                  flex: 1,
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid rgba(0,0,0,0.06)",
                  background: "#fff",
                  fontSize: 13,
                }}
              />
              <div
                style={{
                  background: "#fff",
                  padding: "6px 10px",
                  borderRadius: 8,
                  border: "1px solid rgba(0,0,0,0.04)",
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                }}
              >
                <div style={{ fontSize: 12, color: PALETTE.ink, fontWeight: 700 }}>Showing</div>
                <div
                  style={{
                    fontSize: 12,
                    background: "#f0f7f6",
                    padding: "6px 10px",
                    borderRadius: 999,
                    color: PALETTE.teal,
                    fontWeight: 800,
                  }}
                >
                  {totalFiles}
                </div>
              </div>
            </div>

            {!result && (
              <div style={{ height: 220, display: "flex", alignItems: "center", justifyContent: "center", color: "#666" }}>
                No result yet — upload a file to begin
              </div>
            )}

            {result && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
                  <div
                    style={{
                      padding: 12,
                      borderRadius: 12,
                      background: "#fff",
                      border: "1px solid rgba(0,0,0,0.06)",
                      minHeight: chartHeight + 40,
                      boxShadow: "0 8px 30px rgba(6,22,18,0.04)",
                    }}
                  >
                    <div style={{ height: chartHeight }}>
                      <Bar
                        ref={chartBarRef}
                        data={barData}
                        options={barOptions}
                        plugins={[avgLinePlugin]}
                        onClick={(evt, elements) => handleBarClick(evt, elements)}
                      />
                    </div>
                    <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-end" }}>
                      <div style={{ fontSize: 12, color: PALETTE.muted }}>Tip: click a bar to view files in that group</div>
                    </div>
                  </div>

                  <div
                    style={{
                      padding: 12,
                      borderRadius: 12,
                      background: "#fff",
                      border: "1px solid rgba(0,0,0,0.06)",
                      display: "flex",
                      flexDirection: "column",
                      gap: 12,
                      minHeight: chartHeight + 40,
                      boxShadow: "0 8px 30px rgba(6,22,18,0.04)",
                    }}
                  >
                    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                      <div style={{ width: 140, height: 140 }}>
                        <Doughnut data={donutData} options={donutOptions} plugins={[centerTextPlugin]} />
                      </div>
                      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                        <div style={{ fontWeight: 800, fontSize: 14 }}>Avg Maintainability</div>
                        <div style={{ color: "#5b5b57", marginTop: 8, fontSize: 14 }}>{avgMaintain ? avgMaintain.toFixed(1) : "-"} / 100</div>
                        <div style={{ marginTop: 12, height: chartHeight - 140 }}>
                          <Line ref={chartLineRef} data={lineData} options={lineOptions} onClick={(evt, elements) => handleLineClick(evt, elements)} />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      gridColumn: "1 / -1",
                      padding: 12,
                      borderRadius: 12,
                      background: "#fff",
                      border: "1px solid rgba(0,0,0,0.06)",
                      boxShadow: "0 8px 30px rgba(6,22,18,0.04)",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <h4 style={{ marginTop: 0 }}>Files</h4>
                      <div style={{ color: PALETTE.muted, fontSize: 13 }}>Filtered: {filteredFiles.length}</div>
                    </div>
                    <div style={{ overflowX: "auto", maxHeight: tableMaxHeight, overflowY: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                        <thead>
                          <tr style={{ textAlign: "left", color: PALETTE.ink }}>
                            <th style={{ padding: 10 }}>Path</th>
                            <th style={{ padding: 10 }}>Lines</th>
                            <th style={{ padding: 10 }}>Cyclomatic</th>
                            <th style={{ padding: 10 }}>Maintainability</th>
                            <th style={{ padding: 10 }}>Duplicates</th>
                          </tr>
                        </thead>
                        <tbody>
                          {agg
                            ? agg.labels.map((lbl, idx) => {
                                const paths = agg.mapping[idx] || [];
                                const cyclo = agg.cyclo[idx];
                                const maintain = agg.maintain[idx];
                                return (
                                  <tr key={lbl} style={{ borderTop: "1px solid rgba(0,0,0,0.04)" }}>
                                    <td style={{ padding: 10, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 600 }}>
                                      <button
                                        onClick={() => openModalForLabel(lbl)}
                                        style={{ background: "transparent", border: "none", cursor: "pointer", padding: 0, fontWeight: 700, color: PALETTE.ink }}
                                        title="Click to expand"
                                      >
                                        Group {lbl} ({paths.length} files)
                                      </button>
                                      <div style={{ fontSize: 12, color: PALETTE.muted, marginTop: 6 }}>{paths[0]}{paths.length>1 ? "…" : ""}</div>
                                    </td>
                                    <td style={{ padding: 10 }}>{paths.length}</td>
                                    <td style={{ padding: 10 }}>{cyclo}</td>
                                    <td style={{ padding: 10 }}>{maintain}</td>
                                    <td style={{ padding: 10 }}>—</td>
                                  </tr>
                                );
                              })
                            : (displayFiles.length ? displayFiles : sortedFiles).map((f) => (
                                <tr key={f.path} style={{ borderTop: "1px solid rgba(0,0,0,0.04)" }}>
                                  <td style={{ padding: 10, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 600 }}>
                                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                      <div style={{ width: 10, height: 10, borderRadius: 3, background: rampColor(f.cyclomatic || 0, minCyclo, (minCyclo + maxCyclo) / 2, maxCyclo) }} />
                                      <div style={{ fontWeight: 700 }}>{f.path}</div>
                                    </div>
                                  </td>
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

        <footer style={{ marginTop: 18, textAlign: "center", color: "#27413f" }}>
          Made with ❤️ by&nbsp;
          <a href="https://github.com/shubhmdalvi" target="_blank" rel="noopener noreferrer" style={{ color: "#27413f", textDecoration: "underline", fontWeight: "bold" }}>
            Shubham
          </a>
          &nbsp;- CODALENS
        </footer>
      </div>

      {/* Modal */}
      {modalOpen && (
        <div
          onClick={() => setModalOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(10,12,10,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: 22,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(920px, 96%)",
              maxHeight: "86vh",
              overflow: "auto",
              background: "#fff",
              borderRadius: 12,
              padding: 18,
              boxShadow: "0 30px 80px rgba(2,20,18,0.32)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <h3 style={{ margin: 0 }}>{modalTitle}</h3>
              <button onClick={() => setModalOpen(false)} style={{ ...buttonStyle(PALETTE.yellow) }}>
                Close
              </button>
            </div>
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 13, color: PALETTE.muted, marginBottom: 8 }}>{modalPaths.length} file(s)</div>
              <ul style={{ marginTop: 6 }}>
                {modalPaths.map((p, i) => (
                  <li key={p} style={{ padding: "6px 0", borderBottom: "1px dashed rgba(0,0,0,0.04)", fontSize: 13 }}>
                    {i + 1}. {p}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

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
        button { transition: transform .12s ease, box-shadow .12s ease, filter .12s ease; font-weight: 700; border-radius: 10px; padding: 8px 12px; border: 1px solid rgba(0,0,0,0.08); cursor: pointer; background: #fff; }
        button:focus { outline: 3px solid rgba(0,0,0,0.06); outline-offset: 2px; }
        button:hover { transform: translateY(-3px); box-shadow: 0 14px 30px rgba(6,22,18,0.06); }

        /* responsive layout */
        @media (max-width: 980px) {
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
    border: "1px solid rgba(0,0,0,0.06)",
    borderRadius: 10,
    padding: "8px 12px",
    fontWeight: 700,
    cursor: "pointer",
  };
}
