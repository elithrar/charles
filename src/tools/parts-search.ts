import { defineTool } from '@flue/runtime';

type PartsSearchRequestType =
  | 'identify-part-number'
  | 'look-up-part-number'
  | 'diagnose-parts-needed'
  | 'availability-check'
  | 'general-parts-research';

type PartsVehicleFocus = 'air-cooled-911' | 'bmw-2002' | 'unknown';

type PartsSourceTarget = {
  name: string;
  url?: string;
  query?: string;
  purpose: string;
};

const stopWords = new Set([
  'about',
  'after',
  'availability',
  'available',
  'check',
  'confirm',
  'does',
  'engine',
  'find',
  'for',
  'from',
  'into',
  'look',
  'needed',
  'number',
  'part',
  'parts',
  'price',
  'problem',
  'solve',
  'stock',
  'that',
  'the',
  'this',
  'what',
  'with',
]);

function compactWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function encoded(value: string) {
  return encodeURIComponent(compactWhitespace(value));
}

function detectVehicle(prompt: string): PartsVehicleFocus {
  const normalized = prompt.toLowerCase();
  if (/\b(porsche|911|carrera|sc|motronic|dme|915)\b/.test(normalized)) {
    return 'air-cooled-911';
  }

  if (/\b(bmw|2002|m10|tii|1600-?2|1602|1802|neue klasse)\b/.test(normalized)) {
    return 'bmw-2002';
  }

  return 'unknown';
}

function detectRequestType(prompt: string): PartsSearchRequestType {
  const normalized = prompt.toLowerCase();
  if (/\b(in stock|available|availability|price|cost|buy|order)\b/.test(normalized)) {
    return 'availability-check';
  }

  if (
    /\b(part\s*(no\.?|number|#)|\b\d{3}[ .-]?\d{3}[ .-]?\d{2}|\b\d{2}[ .-]?\d{2}[ .-]?\d[ .-]?\d{3}[ .-]?\d{3})\b/.test(
      normalized,
    )
  ) {
    return 'look-up-part-number';
  }

  if (
    /\b(needed|need|solve|fix|repair|diagnose|issue|problem|symptom|no start|stumble|leak|clunk)\b/.test(
      normalized,
    )
  ) {
    return 'diagnose-parts-needed';
  }

  if (/\b(what part|which part|part for|identify|confirm)\b/.test(normalized)) {
    return 'identify-part-number';
  }

  return 'general-parts-research';
}

function extractYears(prompt: string) {
  return [...new Set([...prompt.matchAll(/\b(19(?:7[0-9]|8[0-9]))\b/g)].map((match) => match[1]))];
}

function extractPossiblePartNumbers(prompt: string) {
  const candidates = [
    ...prompt.matchAll(/\b\d{3}[ .-]?\d{3}[ .-]?\d{2}(?:[ .-]?\d{2})?\b/g),
    ...prompt.matchAll(/\b\d{2}[ .-]?\d{2}[ .-]?\d[ .-]?\d{3}[ .-]?\d{3}\b/g),
  ].map((match) => match[0].replace(/[ .-]/g, ''));

  return [...new Set(candidates)];
}

function searchTerms(prompt: string, vehicle: PartsVehicleFocus, years: string[]) {
  const tokens = prompt
    .toLowerCase()
    .replace(/[^a-z0-9. -]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2 && !stopWords.has(token));
  const vehicleTerms =
    vehicle === 'air-cooled-911'
      ? ['Porsche', '911', ...years]
      : vehicle === 'bmw-2002'
        ? ['BMW', '2002', ...years]
        : years;

  return compactWhitespace([...vehicleTerms, ...tokens].join(' '));
}

function porscheTargets(query: string): PartsSourceTarget[] {
  const q = encoded(query);
  return [
    {
      name: 'Pelican Parts catalog',
      url: `https://www.pelicanparts.com/cgi-bin/ksearch/pel_search_2016.cgi?command=DWsearch&description=${q}`,
      purpose: 'Check Porsche catalog listing, price, fitment notes, and supersessions.',
    },
    {
      name: 'FCP Euro catalog',
      url: `https://www.fcpeuro.com/search?query=${q}`,
      purpose: 'Check current listing, brand options, stock status, and price.',
    },
    {
      name: 'RockAuto catalog',
      url: 'https://www.rockauto.com/',
      query: `RockAuto Porsche 911 ${query}`,
      purpose:
        'Check cross-reference listings, price range, and availability when RockAuto exposes a matching catalog path.',
    },
    {
      name: 'Pelican 911 Technical Forum',
      query: `site:forums.pelicanparts.com/porsche-911-technical-forum/ ${query}`,
      purpose:
        'Find field evidence, fitment caveats, alternate part numbers, and confirmed repairs.',
    },
    {
      name: 'Pelican 911 Engine Rebuilding Forum',
      query: `site:forums.pelicanparts.com/911-engine-rebuilding-forum/ ${query}`,
      purpose:
        'Use when the request touches engine harnesses, Motronic, rebuild work, or engine-bay parts.',
    },
  ];
}

function bmwTargets(query: string): PartsSourceTarget[] {
  const q = encoded(query);
  return [
    {
      name: 'BluntTech catalog',
      url: `https://www.blunttech.com/catalogsearch/result/?q=${q}`,
      purpose: 'Check BMW 2002 vendor listing, price, and availability.',
    },
    {
      name: 'FCP Euro catalog',
      url: `https://www.fcpeuro.com/search?query=${q}`,
      purpose: 'Check current listing, brand options, stock status, and price.',
    },
    {
      name: 'RockAuto catalog',
      url: 'https://www.rockauto.com/',
      query: `RockAuto BMW 2002 ${query}`,
      purpose:
        'Check cross-reference listings, price range, and availability when RockAuto exposes a matching catalog path.',
    },
    {
      name: 'BMW2002FAQ forum',
      query: `site:bmw2002faq.com/forums/ BMW 2002 ${query}`,
      purpose: 'Find practical fitment, repair, and part-number confirmation from 2002 owners.',
    },
    {
      name: 'RealOEM BMW diagrams',
      query: `site:realoem.com BMW 2002 ${query}`,
      purpose: 'Cross-check OE part identity and diagram context before relying on vendor search.',
    },
  ];
}

function sharedTargets(query: string): PartsSourceTarget[] {
  const q = encoded(query);
  return [
    {
      name: 'Pelican Parts catalog',
      url: `https://www.pelicanparts.com/cgi-bin/ksearch/pel_search_2016.cgi?command=DWsearch&description=${q}`,
      purpose: 'Check catalog results if the request is Porsche-related or ambiguous.',
    },
    {
      name: 'FCP Euro catalog',
      url: `https://www.fcpeuro.com/search?query=${q}`,
      purpose: 'Check catalog results for Porsche or BMW applications.',
    },
    {
      name: 'RockAuto catalog',
      url: 'https://www.rockauto.com/',
      query: `RockAuto ${query}`,
      purpose:
        'Check cross-reference listings, price range, and availability when RockAuto exposes a matching catalog path.',
    },
    {
      name: 'BluntTech catalog',
      url: `https://www.blunttech.com/catalogsearch/result/?q=${q}`,
      purpose: 'Check catalog results if the request is BMW 2002-related or ambiguous.',
    },
  ];
}

export function buildPartsSearchPlan(prompt: string) {
  const vehicle = detectVehicle(prompt);
  const years = extractYears(prompt);
  const possiblePartNumbers = extractPossiblePartNumbers(prompt);
  const query = searchTerms(prompt, vehicle, years);
  const sourceTargets =
    vehicle === 'air-cooled-911'
      ? porscheTargets(query)
      : vehicle === 'bmw-2002'
        ? bmwTargets(query)
        : sharedTargets(query);

  return {
    requestType: detectRequestType(prompt),
    vehicle,
    focus:
      vehicle === 'air-cooled-911'
        ? '1974-1989 air-cooled Porsche 911, with special care for 1984-1989 Carrera 3.2 Motronic fitment.'
        : vehicle === 'bmw-2002'
          ? 'Early BMW 2002, especially 1970 2002 and related M10/carbureted variants.'
          : 'Ask whether this is for an air-cooled Porsche 911 or BMW 2002 before making fitment claims.',
    years,
    possiblePartNumbers,
    query,
    sourceTargets,
    verificationChecklist: [
      'Identify the exact car: year, model, submodel, engine/fuel system, market, and relevant VIN or production split when available.',
      'Find the OE or supplier part number from a catalog, diagram, stamped part, or vendor listing. Do not invent a part number from memory.',
      'Cross-check the part number against at least one independent source: vendor listing, RealOEM/BMW diagram, Pelican forum, BMW2002FAQ, or technical article.',
      'For availability or price, inspect the live vendor page and report stock status, price, brand, and URL with timestamp-sensitive caveats.',
      'For symptom-driven requests, list the diagnostic evidence needed before recommending replacement parts; avoid parts-cannon answers.',
      'Flag supersessions, NLA status, used-only parts, core charges, harness rebuild options, and VIN/year-sensitive fitment.',
    ],
    responseContract: [
      'Lead with the answer or the blocking uncertainty, not the list of searched sources.',
      'Show candidate part numbers with confidence labels: verified, likely, assumption, or unknown.',
      'Include vendor, price, stock status, and URL when the request asks for availability or price.',
      'Cite every source URL used for a fitment, price, stock, or diagnostic claim.',
      'Ask one concise clarifying question only when fitment cannot be narrowed safely.',
    ],
  };
}

export function createPartsSearchTools() {
  return [
    defineTool({
      name: 'parts_search',
      description:
        'Build a fitment-aware research plan for air-cooled Porsche 911 (1974-1989) and early BMW 2002 parts requests. Use before web search when the user asks what part fits, asks to confirm a part number, asks for stock/price, or asks what parts solve a car problem.',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description:
              'The full user parts request, including car/year/submodel, symptoms, candidate part numbers, and requested vendors when available.',
          },
        },
        required: ['prompt'],
        additionalProperties: false,
      },
      async execute(args) {
        return JSON.stringify(buildPartsSearchPlan((args as { prompt: string }).prompt), null, 2);
      },
    }),
  ];
}

export const PARTS_SEARCH_AGENT_INSTRUCTIONS = `
<parts_search_tool>
Use the parts_search tool before answering automotive parts requests for air-cooled Porsche 911s or BMW 2002s.

Parts-search policy:
- Treat parts requests as research tasks that require live source verification, not model-memory answers.
- Expected request shapes include: "what part for X", "confirm whether part number Y fits or is in stock", and "what parts are needed to solve Z problem".
- For Porsche, focus on 1974-1989 air-cooled 911s, especially Carrera 3.2 Motronic, CIS cars, 915-related parts, engine-bay harnesses, and year-sensitive fitment.
- For BMW, focus on early BMW 2002s, especially a 1970 2002, M10, carbureted cars, and common owner/vendor sources.
- Use Pelican Parts, FCP Euro, RockAuto, BluntTech, Pelican Parts forums, BMW2002FAQ, RealOEM/BMW diagrams, and Exa/web search as complementary evidence.
- For price or stock, inspect live vendor pages with browser_run or Exa fetch. State if a site blocks access or does not expose stock reliably.
- Do not claim a part number is confirmed unless a cited source supports it. Use confidence labels when evidence is incomplete.
</parts_search_tool>`;
