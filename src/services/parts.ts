export type PartsSearchRequest = {
  prompt: string;
};

export type PartsSearchResult = {
  sources: string[];
  candidates: Array<{
    source: string;
    query: string;
    url: string;
    caveat: string;
  }>;
  nextQuestions: string[];
};

const sources = [
  { name: 'FCP Euro', url: 'https://www.fcpeuro.com/search?query=' },
  {
    name: 'Pelican Parts',
    url: 'https://www.pelicanparts.com/cgi-bin/ksearch/pel_search_2016.cgi?command=DWsearch&description=',
  },
  { name: 'Blunttech', url: 'https://www.blunttech.com/catalogsearch/result/?q=' },
];

export function buildPartsSearchStub({ prompt }: PartsSearchRequest): PartsSearchResult {
  const query = prompt.trim() || 'Porsche 911 BMW 2002 parts';
  const encoded = encodeURIComponent(query);

  return {
    sources: sources.map((source) => source.name),
    candidates: sources.map((source) => ({
      source: source.name,
      query,
      url: `${source.url}${encoded}`,
      caveat: 'Stubbed search URL only. Confirm fitment before ordering.',
    })),
    nextQuestions: [
      'Which car is this for: Porsche 911 Carrera 3.2 or BMW 2002?',
      'What production year, submodel, and VIN details affect fitment?',
    ],
  };
}
