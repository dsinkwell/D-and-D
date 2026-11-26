// Shared by the build script (which creates the SRD index) and the app (which loads it).
// Keep both sides identical or MiniSearch.loadJSON will produce wrong results.
export const SEARCH_OPTIONS = {
  fields: ['title', 'aliases', 'parent', 'text'],
  storeFields: [],
  searchOptions: {
    boost: { title: 8, aliases: 6, parent: 1.5, text: 1 },
    prefix: true,
    fuzzy: 0.15,
    combineWith: 'AND',
  },
};
