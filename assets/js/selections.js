/**
 * Special Selections — curated sets of pulsars chosen by the scientific
 * (or wider) community for some notable reason. Each entry becomes a toggle
 * in the sidebar under "Special Selections". When one or more are active,
 * only stars in the union of the active sets are shown; every other filter
 * is bypassed.
 *
 * jnames must match the `jname` column of the catalogue (ATNF J2000 names).
 */
export const SELECTIONS = [
  {
    id: 'voyager',
    label: 'Voyager / Pioneer map',
    color: 0xd4a84b,
    description: 'The 14 pulsars encoded on the Pioneer plaque (1972) and Voyager Golden Record cover (1977). Frank Drake chose the best-timed pulsars known at the time; their periods in binary (in units of the hydrogen hyperfine transition) let a finder locate the Sun and date the launch.',
    source: 'https://www.johnstonsarchive.net/astro/pulsarmap.html',
    jnames: [
      'J1731-4744', // B1727-47
      'J1456-6843', // B1451-68
      'J1243-6423', // B1240-64
      'J0835-4510', // B0833-45  (Vela)
      'J0953+0755', // B0950+08
      'J0826+2637', // B0823+26
      'J0534+2200', // B0531+21  (Crab)
      'J0528+2200', // B0525+21
      'J0332+5434', // B0329+54
      'J2219+4754', // B2217+47
      'J2018+2839', // B2016+28
      'J1935+1616', // B1933+16
      'J1932+1059', // B1929+10
      'J1645-0317', // B1642-03
    ],
  },
  {
    id: 'sextant',
    label: 'SEXTANT X-ray navigation',
    color: 0x5ee6c8,
    description: 'The four millisecond pulsars used by NASA\'s SEXTANT experiment on the NICER telescope (ISS, November 2017) for the first in-space demonstration of X-ray pulsar navigation — fixing the station\'s position to within ~5 km from pulse arrival times alone.',
    source: 'https://www.nasa.gov/centers-and-facilities/goddard/nasa-team-first-to-demonstrate-x-ray-navigation-in-space/',
    jnames: [
      'J0218+4232',
      'J1824-2452A', // B1821-24 (in globular cluster M28)
      'J0030+0451',
      'J0437-4715',
    ],
  },
];
