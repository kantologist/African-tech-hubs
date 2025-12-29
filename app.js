/* global Papa, L, $ */

const CSV_PATH = "./african_tech_hubs_public_v1_geocoded.csv";

let allRows = [];
let dt = null;

let map = null;
let clusterLayer = null;
let markersById = new Map(); // id -> marker
let rowIdByMarker = new Map();

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

function normalizeRows(rows) {
  return rows.map((r, idx) => {
    const lat = toNum(r.latitude);
    const lng = toNum(r.longitude);
    return {
      _id: String(idx),
      hub_name: norm(r.hub_name),
      hub_type: norm(r.hub_type),
      operational_status: norm(r.operational_status),
      street_address: norm(r.street_address),
      city: norm(r.city),
      country: norm(r.country),
      region: norm(r.region) || "", // if present
      website: norm(r.website),
      email: norm(r.email),
      phone: norm(r.phone),
      source: norm(r.source),
      latitude: lat,
      longitude: lng
    };
  });
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