// Shared option lists + label lookups for the Rental Price Check form and
// results display, so both use the exact same human-readable labels
// instead of each maintaining its own copy.
//
// Mirrors backend/routes/rentalPriceCheck.js's VALID_DWELLING_TYPES exactly.
// There's no endpoint for this (it's a small fixed set), so it's kept here
// in sync by hand — if the backend list ever changes, update this too.
export const DWELLING_TYPES = [
  { value: 'ALL', label: 'Any dwelling type' },
  { value: 'Apartment', label: 'Apartment' },
  { value: 'Boarding House', label: 'Boarding House' },
  { value: 'Flat', label: 'Flat' },
  { value: 'House', label: 'House' },
  { value: 'Room', label: 'Room' },
];

// Mirrors backend/routes/rentalPriceCheck.js's VALID_NUMBER_OF_BEDS, minus
// 'ALL' (the form's "Any" option omits the param entirely instead, since the
// backend treats an omitted/empty number_of_beds as identical to 'ALL' —
// no need to offer both). Same order as the backend's own validation-error
// message, so if that ever surfaces to a user it matches what they saw here.
//
// '5' and '5+' are genuinely distinct, coexisting MBIE categories, not a
// duplicate/typo — confirmed against the actual data: some suburbs have
// *both* a '5' row and a '5+' row for the same dwelling type, with
// different median_rent and total_bonds (the '5+' row's sample size is
// consistently larger, consistent with it being a "5 or more" aggregate
// that overlaps with the exact-5 bucket rather than a disjoint "6+").
// Labelled explicitly below so a user doesn't read them as a strictly
// increasing, mutually-exclusive scale.
//
// 0, 6, 8, 9 and 15 currently have zero rows in the database for any
// suburb — left in deliberately (not a bug) so the fallback/
// insufficient_data behaviour stays reachable from the UI for testing.
export const NUMBER_OF_BEDS_OPTIONS = [
  { value: '0', label: '0 bedrooms' },
  { value: '1', label: '1 bedroom' },
  { value: '2', label: '2 bedrooms' },
  { value: '3', label: '3 bedrooms' },
  { value: '4', label: '4 bedrooms' },
  { value: '5', label: 'Exactly 5 bedrooms' },
  { value: '6', label: '6 bedrooms' },
  { value: '7', label: '7 bedrooms' },
  { value: '8', label: '8 bedrooms' },
  { value: '9', label: '9 bedrooms' },
  { value: '15', label: '15 bedrooms' },
  {
    value: '5+',
    label: '5 or more bedrooms',
    title: "Separate MBIE category from 'Exactly 5 bedrooms' — a broader 5-or-more aggregate, not a duplicate.",
  },
];

export function getDwellingTypeLabel(value) {
  return DWELLING_TYPES.find((type) => type.value === value)?.label ?? value;
}

// Pluralised for use as a noun ("No data for Apartments in ...") rather
// than as the adjective getDwellingTypeLabel gives ("the Apartment median
// rent"). Plain +'s' is correct for every real dwelling type in the
// current fixed list (House -> Houses, Boarding House -> Boarding Houses,
// ...). 'ALL' ("Any dwelling type") is left unpluralised — "Any dwelling
// types" reads wrong — since it isn't a countable noun.
export function getDwellingTypePluralLabel(value) {
  const label = getDwellingTypeLabel(value);
  return value === 'ALL' ? label : `${label}s`;
}

export function getNumberOfBedsLabel(value) {
  return NUMBER_OF_BEDS_OPTIONS.find((option) => option.value === value)?.label ?? value;
}
