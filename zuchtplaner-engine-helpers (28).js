
function flattenTraitPotentials(traits) {
  const map = {};
  for (const entries of Object.values(traits || {})) {
    for (const e of entries || []) map[e.name] = e.potential;
  }
  return map;
}

function findDisciplineCategory(disciplines, name) {
  if (!disciplines || !name) return null;
  for (const [category, entries] of Object.entries(disciplines)) {
    if ((entries || []).some((e) => e.name === name)) return category;
  }
  return null;
}

function isDiseaseAusgepraegt(value) {
  if (!value) return false;
  const parts = value.split('/').map((p) => p.trim()).filter(Boolean);
  if (parts.length !== 2) return false;
  return parts[0] !== 'NN' && parts[0] === parts[1];
}
