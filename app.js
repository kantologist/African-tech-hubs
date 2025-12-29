/* global Papa, L, $, Chart */

const CSV_PATH = "./african_tech_hubs_public_v1_geocoded.csv";

let allRows = [];
let dt = null;

let map = null;
let clusterLayer = null;
let markersById = new Map(); // id -> marker
let rowIdByMarker = new Map();

let charts = {
  country: null,
  type: null,
  region: null,
  geocoding: null
};

function norm(s) {
  return String(s ?? "").trim();
}

function toNum(x) {
  const v = Number(String(x ?? "").trim());
  return Number.isFinite(v) ? v : null;
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function setStats(filteredCount) {
  const total = allRows.length;
  const geocoded = allRows.filter(r => r.latitude != null && r.longitude != null).length;
  const pct = total ? Math.round((geocoded / total) * 100) : 0;

  document.getElementById("stats").textContent =
    `Showing ${filteredCount.toLocaleString()} of ${total.toLocaleString()} hubs · Geocoded: ${geocoded.toLocaleString()} (${pct}%)`;
}

function buildDropdown(id, options) {
  const el = document.getElementById(id);
  // keep first option ("All")
  while (el.options.length > 1) el.remove(1);
  options.forEach(v => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    el.appendChild(opt);
  });
}

function passesFilters(r) {
  const c = norm(document.getElementById("countrySelect").value);
  const reg = norm(document.getElementById("regionSelect").value);
  const t = norm(document.getElementById("typeSelect").value);
  const q = norm(document.getElementById("searchInput").value).toLowerCase();

  if (c && r.country !== c) return false;
  if (reg && r.region !== reg) return false;
  if (t && r.hub_type !== t) return false;

  if (q) {
    const hay = `${r.hub_name} ${r.city} ${r.country} ${r.hub_type}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

function filteredRows() {
  return allRows.filter(passesFilters);
}

function initMap() {
  map = L.map("map", { preferCanvas: true }).setView([7.5, 20], 3);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);

  clusterLayer = L.markerClusterGroup({ showCoverageOnHover: false });
  map.addLayer(clusterLayer);
}

function popupHtml(r) {
  const website = r.website ? `<a href="${r.website}" target="_blank" rel="noopener">Website</a>` : "";
  const email = r.email ? `<a href="mailto:${r.email}">${r.email}</a>` : "";
  const src = r.source ? `<a href="${r.source}" target="_blank" rel="noopener">Source</a>` : "";
  const bits = [website, src].filter(Boolean).join(" · ");

  return `
    <div style="min-width:220px">
      <div style="font-weight:700">${escapeHtml(r.hub_name)}</div>
      <div style="color:#6b7280; margin:2px 0 6px">${escapeHtml(r.hub_type || "")}</div>
      <div>${escapeHtml(r.city || "")}, ${escapeHtml(r.country || "")}</div>
      ${email ? `<div style="margin-top:6px">${email}</div>` : ""}
      ${bits ? `<div style="margin-top:6px">${bits}</div>` : ""}
      <div style="margin-top:8px">
        <button data-rowid="${r._id}" class="zoomToRowBtn" style="
          padding:6px 8px; border-radius:8px; border:1px solid rgba(0,0,0,0.12);
          cursor:pointer;">Highlight in table</button>
      </div>
    </div>
  `;
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function rebuildMarkers(rows) {
  clusterLayer.clearLayers();
  markersById.clear();
  rowIdByMarker.clear();

  const bounds = [];

  rows.forEach(r => {
    if (r.latitude == null || r.longitude == null) return;

    const marker = L.marker([r.latitude, r.longitude]);
    marker.bindPopup(popupHtml(r), { maxWidth: 360 });

    marker.on("popupopen", () => {
      // wire button inside popup
      setTimeout(() => {
        document.querySelectorAll(".zoomToRowBtn").forEach(btn => {
          btn.onclick = () => highlightRow(btn.getAttribute("data-rowid"));
        });
      }, 0);
    });

    markersById.set(r._id, marker);
    rowIdByMarker.set(marker, r._id);
    clusterLayer.addLayer(marker);
    bounds.push([r.latitude, r.longitude]);
  });

  if (bounds.length) {
    map.fitBounds(bounds, { padding: [30, 30] });
  }
}

function initTable(rows) {
  const tbody = document.querySelector("#hubsTable tbody");
  tbody.innerHTML = "";

  rows.forEach(r => {
    const tr = document.createElement("tr");
    tr.setAttribute("data-rowid", r._id);

    const website = r.website ? `<a href="${r.website}" target="_blank" rel="noopener">link</a>` : "";
    const email = r.email ? `<a href="mailto:${r.email}">${escapeHtml(r.email)}</a>` : "";
    const phone = r.phone ? escapeHtml(r.phone) : "";
    const source = r.source ? `<a href="${r.source}" target="_blank" rel="noopener">source</a>` : "";

    tr.innerHTML = `
      <td>${escapeHtml(r.hub_name)}</td>
      <td>${escapeHtml(r.hub_type || "")}</td>
      <td>${escapeHtml(r.city || "")}</td>
      <td>${escapeHtml(r.country || "")}</td>
      <td>${website}</td>
      <td>${email}</td>
      <td>${phone}</td>
      <td>${source}</td>
    `;
    tbody.appendChild(tr);
  });

  if (dt) dt.destroy();
  dt = $("#hubsTable").DataTable({
    pageLength: 25,
    order: [[3, "asc"], [2, "asc"], [0, "asc"]],
    dom: "tip" // table + info + pagination (search handled externally)
  });

  // clicking a row zooms map
  $("#hubsTable tbody").off("click").on("click", "tr", function () {
    const rowid = this.getAttribute("data-rowid");
    const marker = markersById.get(rowid);
    if (marker) {
      map.setView(marker.getLatLng(), 13, { animate: true });
      marker.openPopup();
    }
    highlightRow(rowid);
  });
}

function highlightRow(rowid) {
  // scroll + highlight
  document.querySelectorAll("#hubsTable tbody tr").forEach(tr => tr.classList.remove("row-highlight"));
  const tr = document.querySelector(`#hubsTable tbody tr[data-rowid="${CSS.escape(rowid)}"]`);
  if (tr) {
    tr.classList.add("row-highlight");
    tr.scrollIntoView({ block: "center", behavior: "smooth" });
  }
}

// styling for highlight
const style = document.createElement("style");
style.textContent = `
  .row-highlight td { background: rgba(125,211,252,0.12) !important; }
`;
document.head.appendChild(style);

function applyFilters() {
  const rows = filteredRows();
  setStats(rows.length);

  // update table
  initTable(rows);

  // update markers
  rebuildMarkers(rows);

  // update dashboard if visible
  if (document.getElementById("dashboardPanel").classList.contains("active")) {
    updateDashboard(rows);
  }
}

function wireControls() {
  ["countrySelect", "regionSelect", "typeSelect"].forEach(id => {
    document.getElementById(id).addEventListener("change", applyFilters);
  });

  const search = document.getElementById("searchInput");
  let t = null;
  search.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(applyFilters, 120); // debounce
  });

  document.getElementById("resetBtn").addEventListener("click", () => {
    document.getElementById("countrySelect").value = "";
    document.getElementById("regionSelect").value = "";
    document.getElementById("typeSelect").value = "";
    document.getElementById("searchInput").value = "";
    applyFilters();
  });

  // Dashboard toggle
  document.getElementById("dashboardToggle").addEventListener("click", () => {
    const panel = document.getElementById("dashboardPanel");
    const toggle = document.getElementById("dashboardToggle");
    const main = document.querySelector("main");
    panel.classList.toggle("active");
    toggle.classList.toggle("active");
    main.classList.toggle("dashboard-mode");
    
    if (panel.classList.contains("active")) {
      updateDashboard(filteredRows());
    }
  });

  document.getElementById("closeDashboard").addEventListener("click", () => {
    const panel = document.getElementById("dashboardPanel");
    const toggle = document.getElementById("dashboardToggle");
    const main = document.querySelector("main");
    panel.classList.remove("active");
    toggle.classList.remove("active");
    main.classList.remove("dashboard-mode");
  });

  // Download button
  document.getElementById("downloadBtn").addEventListener("click", downloadDataset);
}

function parseCsv() {
  return new Promise((resolve, reject) => {
    Papa.parse(CSV_PATH, {
      header: true,
      download: true,
      skipEmptyLines: true,
      complete: (res) => resolve(res.data),
      error: reject
    });
  });
}

function getRegionByCountry(country) {
  const countryNorm = norm(country).toLowerCase().trim();
  
  // Northern Africa
  const northernAfrica = [
    "algeria", "egypt", "libya", "morocco", "sudan", "tunisia", "western sahara"
  ];
  
  // Western Africa
  const westernAfrica = [
    "benin", "burkina faso", "cape verde", "côte d'ivoire", "cote d'ivoire", "ivory coast", 
    "gambia", "ghana", "guinea", "guinea-bissau", "guinea bissau", "liberia", "mali", 
    "mauritania", "niger", "nigeria", "senegal", "sierra leone", "togo"
  ];
  
  // Eastern Africa
  const easternAfrica = [
    "burundi", "comoros", "djibouti", "eritrea", "ethiopia", "kenya", "madagascar",
    "malawi", "mauritius", "mozambique", "rwanda", "seychelles", "somalia",
    "south sudan", "tanzania", "uganda", "zambia", "zimbabwe"
  ];
  
  // Central Africa
  const centralAfrica = [
    "angola", "cameroon", "central african republic", "chad", "congo", 
    "democratic republic of the congo", "dr congo", "drc", "equatorial guinea", 
    "gabon", "são tomé and príncipe", "sao tome and principe"
  ];
  
  // Southern Africa
  const southernAfrica = [
    "botswana", "eswatini", "swaziland", "lesotho", "namibia", "south africa"
  ];
  
  // Check exact matches first
  if (northernAfrica.includes(countryNorm)) return "Northern Africa";
  if (westernAfrica.includes(countryNorm)) return "Western Africa";
  if (easternAfrica.includes(countryNorm)) return "Eastern Africa";
  if (centralAfrica.includes(countryNorm)) return "Central Africa";
  if (southernAfrica.includes(countryNorm)) return "Southern Africa";
  
  // Check partial matches for variations
  if (countryNorm.includes("congo") || countryNorm.includes("drc")) return "Central Africa";
  if (countryNorm.includes("ivory") || countryNorm.includes("côte")) return "Western Africa";
  if (countryNorm.includes("south sudan")) return "Eastern Africa";
  if (countryNorm.includes("são tomé") || countryNorm.includes("sao tome")) return "Central Africa";
  if (countryNorm.includes("swaziland") || countryNorm.includes("eswatini")) return "Southern Africa";
  
  return "Unknown";
}

function normalizeRows(rows) {
  return rows
    .filter(r => {
      // Remove France from the dataset
      const country = norm(r.country).toLowerCase();
      return country !== "france";
    })
    .map((r, idx) => {
      const lat = toNum(r.latitude);
      const lng = toNum(r.longitude);
      const country = norm(r.country);
      const region = norm(r.region) || getRegionByCountry(country);
      
      return {
        _id: String(idx),
        hub_name: norm(r.hub_name),
        hub_type: norm(r.hub_type),
        operational_status: norm(r.operational_status),
        street_address: norm(r.street_address),
        city: norm(r.city),
        country: country,
        region: region,
        website: norm(r.website),
        email: norm(r.email),
        phone: norm(r.phone),
        source: norm(r.source),
        latitude: lat,
        longitude: lng
      };
    });
}

function calculateAnalytics(rows) {
  const total = rows.length;
  const geocoded = rows.filter(r => r.latitude != null && r.longitude != null).length;
  const withWebsite = rows.filter(r => r.website).length;
  const withEmail = rows.filter(r => r.email).length;

  // Country distribution
  const countryCounts = {};
  rows.forEach(r => {
    const country = r.country || "Unknown";
    countryCounts[country] = (countryCounts[country] || 0) + 1;
  });
  const topCountries = Object.entries(countryCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  // Type distribution
  const typeCounts = {};
  rows.forEach(r => {
    const type = r.hub_type || "Unknown";
    typeCounts[type] = (typeCounts[type] || 0) + 1;
  });

  // Region distribution
  const regionCounts = {};
  rows.forEach(r => {
    const region = r.region || "Unknown";
    regionCounts[region] = (regionCounts[region] || 0) + 1;
  });

  return {
    total,
    geocoded,
    geocodedPct: total ? Math.round((geocoded / total) * 100) : 0,
    withWebsite,
    withWebsitePct: total ? Math.round((withWebsite / total) * 100) : 0,
    withEmail,
    withEmailPct: total ? Math.round((withEmail / total) * 100) : 0,
    topCountries,
    typeCounts,
    regionCounts
  };
}

function updateDashboard(rows) {
  const analytics = calculateAnalytics(rows);
  const allAnalytics = calculateAnalytics(allRows);

  // Update stat cards
  const statsGrid = document.getElementById("statsGrid");
  statsGrid.innerHTML = `
    <div class="stat-card">
      <div class="stat-label">Total Hubs</div>
      <div class="stat-value">${analytics.total.toLocaleString()}</div>
      <div class="stat-change">of ${allAnalytics.total.toLocaleString()} total</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Geocoded</div>
      <div class="stat-value">${analytics.geocoded.toLocaleString()}</div>
      <div class="stat-change">${analytics.geocodedPct}% coverage</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">With Website</div>
      <div class="stat-value">${analytics.withWebsite.toLocaleString()}</div>
      <div class="stat-change">${analytics.withWebsitePct}% of hubs</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">With Email</div>
      <div class="stat-value">${analytics.withEmail.toLocaleString()}</div>
      <div class="stat-change">${analytics.withEmailPct}% of hubs</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Unique Countries</div>
      <div class="stat-value">${new Set(rows.map(r => r.country)).size}</div>
      <div class="stat-change">Countries represented</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Hub Types</div>
      <div class="stat-value">${Object.keys(analytics.typeCounts).length}</div>
      <div class="stat-change">Different types</div>
    </div>
  `;

  // Update charts
  updateCountryChart(analytics.topCountries);
  updateTypeChart(analytics.typeCounts);
  updateRegionChart(analytics.regionCounts);
  updateGeocodingChart(analytics.geocoded, analytics.total - analytics.geocoded);
}

function updateCountryChart(data) {
  const ctx = document.getElementById("countryChart").getContext("2d");
  
  if (charts.country) {
    charts.country.destroy();
  }

  charts.country = new Chart(ctx, {
    type: "bar",
    data: {
      labels: data.map(d => d[0]),
      datasets: [{
        label: "Number of Hubs",
        data: data.map(d => d[1]),
        backgroundColor: "rgba(125,211,252,0.6)",
        borderColor: "rgba(125,211,252,1)",
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            color: "rgba(156,163,175,0.8)"
          },
          grid: {
            color: "rgba(255,255,255,0.05)"
          }
        },
        x: {
          ticks: {
            color: "rgba(156,163,175,0.8)"
          },
          grid: {
            color: "rgba(255,255,255,0.05)"
          }
        }
      }
    }
  });
}

function updateTypeChart(data) {
  const ctx = document.getElementById("typeChart").getContext("2d");
  
  if (charts.type) {
    charts.type.destroy();
  }

  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const colors = [
    "rgba(125,211,252,0.8)",
    "rgba(59,130,246,0.8)",
    "rgba(147,197,253,0.8)",
    "rgba(96,165,250,0.8)",
    "rgba(37,99,235,0.8)",
    "rgba(29,78,216,0.8)"
  ];

  charts.type = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: entries.map(d => d[0]),
      datasets: [{
        data: entries.map(d => d[1]),
        backgroundColor: entries.map((_, i) => colors[i % colors.length]),
        borderColor: "rgba(15,27,51,1)",
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "right",
          labels: {
            color: "rgba(229,231,235,0.9)",
            padding: 12
          }
        }
      }
    }
  });
}

function updateRegionChart(data) {
  const ctx = document.getElementById("regionChart").getContext("2d");
  
  if (charts.region) {
    charts.region.destroy();
  }

  const entries = Object.entries(data).filter(d => d[0] !== "Unknown").sort((a, b) => b[1] - a[1]);
  const colors = [
    "rgba(125,211,252,0.8)",
    "rgba(59,130,246,0.8)",
    "rgba(147,197,253,0.8)",
    "rgba(96,165,250,0.8)",
    "rgba(37,99,235,0.8)"
  ];

  charts.region = new Chart(ctx, {
    type: "pie",
    data: {
      labels: entries.map(d => d[0]),
      datasets: [{
        data: entries.map(d => d[1]),
        backgroundColor: entries.map((_, i) => colors[i % colors.length]),
        borderColor: "rgba(15,27,51,1)",
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "right",
          labels: {
            color: "rgba(229,231,235,0.9)",
            padding: 12
          }
        }
      }
    }
  });
}

function updateGeocodingChart(geocoded, notGeocoded) {
  const ctx = document.getElementById("geocodingChart").getContext("2d");
  
  if (charts.geocoding) {
    charts.geocoding.destroy();
  }

  charts.geocoding = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["Geocoded", "Not Geocoded"],
      datasets: [{
        data: [geocoded, notGeocoded],
        backgroundColor: [
          "rgba(125,211,252,0.8)",
          "rgba(156,163,175,0.4)"
        ],
        borderColor: "rgba(15,27,51,1)",
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "right",
          labels: {
            color: "rgba(229,231,235,0.9)",
            padding: 12
          }
        }
      }
    }
  });
}

function downloadDataset() {
  const rows = filteredRows();
  
  // Convert rows to CSV format
  if (rows.length === 0) {
    alert("No data to download. Please adjust your filters.");
    return;
  }

  // Get all unique keys from rows
  const keys = new Set();
  rows.forEach(row => {
    Object.keys(row).forEach(key => {
      if (key !== "_id") keys.add(key);
    });
  });
  const headers = Array.from(keys).sort();

  // Create CSV content
  const csvRows = [];
  csvRows.push(headers.join(","));

  rows.forEach(row => {
    const values = headers.map(header => {
      const value = row[header] || "";
      // Escape quotes and wrap in quotes if contains comma or quote
      if (value.includes(",") || value.includes('"') || value.includes("\n")) {
        return `"${String(value).replace(/"/g, '""')}"`;
      }
      return value;
    });
    csvRows.push(values.join(","));
  });

  const csvContent = csvRows.join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  
  link.setAttribute("href", url);
  link.setAttribute("download", `african_tech_hubs_${new Date().toISOString().split("T")[0]}.csv`);
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

async function main() {
  initMap();

  const raw = await parseCsv();
  allRows = normalizeRows(raw);

  // If region column missing, derive simple region (optional)
  if (!allRows.some(r => r.region)) {
    // You already have region in your dashboards build, but just in case:
    // leave blank; filters still work for country/type.
  }

  buildDropdown("countrySelect", uniqueSorted(allRows.map(r => r.country)));
  buildDropdown("regionSelect", uniqueSorted(allRows.map(r => r.region).filter(Boolean)));
  buildDropdown("typeSelect", uniqueSorted(allRows.map(r => r.hub_type)));

  wireControls();
  applyFilters();
}

main().catch(err => {
  console.error(err);
  alert("Failed to load CSV. If you opened index.html directly, please serve via a local web server.");
});