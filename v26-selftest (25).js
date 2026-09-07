
// Nur Entwicklungs-Selbsttest, nicht in HTML eingebunden.
// Prüft:
// 1) Unknown auf beiden Seiten => KEINE Verwandtschaft.
// 2) eigener Name doppelt nur auf derselben Seite => KEINE Verwandtschaft.
// 3) echter gemeinsamer Vorfahr auf Mutter+Vaterseite => Verwandtschaft.

function v26SelfTest() {
  const mk = (name, ancestors) => ({name, pedigree:{ancestors:ancestors.map(name=>({name}))}});

  const mare1 = mk('Mare A', ['Unknown','Unknown','Mare A','X']);
  const stall1 = mk('Stallion B', ['Unknown','Unknown','Stallion B','Y']);
  if (findSharedNames(mare1,stall1).length !== 0) throw new Error('Unknown/same-side duplicate incorrectly blocks pairing');

  const mare2 = mk('Mare A', ['Shared One','M2']);
  const stall2 = mk('Stallion B', ['Shared One','S2']);
  const r = findSharedNames(mare2,stall2);
  if (!r.some(x => normalizeName(x.name) === 'shared one')) throw new Error('Real shared ancestor not detected');

  return true;
}
