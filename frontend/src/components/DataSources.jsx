// Attribution for every dataset this app is built from. Shown on every page
// (it lives in the App layout), always visible rather than collapsed: the
// licences below require credit, and OpenStreetMap's terms specifically ask
// that the attribution be displayed. Keep this in sync with the datasets
// list in the repo's README.md (which also records where each was obtained
// and how it was used) — if a source is added or its licence changes, update
// both.
//
// Licences, as confirmed from each publisher's own page:
//   MBIE rental bond data ........ CC BY 3.0 NZ; credit "The Ministry of
//                                  Business, Innovation and Employment"
//   Stats NZ SA2 2019 layers ..... CC BY 4.0 (data.govt.nz catalogue entries)
//   Waikato bus stops ............ CC BY 4.0; the council's own wording is
//                                  "© Waikato Regional Council 2022 Licensed
//                                  under CC BY 4.0."
//   Hamilton Lake outline ........ ODbL 1.0; "© OpenStreetMap contributors"
//
// CC BY also asks that changes be indicated, hence the closing sentence
// about the data having been processed and combined.
function ExternalLink({ href, children }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

function DataSources() {
  return (
    <footer className="data-sources">
      <p className="data-sources-title">Data sources</p>
      <ul>
        <li>
          Rental prices:{' '}
          <ExternalLink href="https://www.tenancy.govt.nz/about-tenancy-services/data-and-statistics/rental-bond-data/">
            rental bond data
          </ExternalLink>
          , The Ministry of Business, Innovation and Employment (MBIE), licensed under{' '}
          <ExternalLink href="https://creativecommons.org/licenses/by/3.0/nz/">CC BY 3.0 NZ</ExternalLink>.
        </li>
        <li>
          Suburb boundaries and centres:{' '}
          <ExternalLink href="https://datafinder.stats.govt.nz/">Stats NZ</ExternalLink>
          {' '}Statistical Area 2 2019, licensed under{' '}
          <ExternalLink href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</ExternalLink>.
        </li>
        <li>
          Bus stops: © Waikato Regional Council 2022. Licensed under{' '}
          <ExternalLink href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</ExternalLink>.
        </li>
        <li>
          Hamilton Lake outline: ©{' '}
          <ExternalLink href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</ExternalLink>
          , available under the{' '}
          <ExternalLink href="https://opendatacommons.org/licenses/odbl/1-0/">Open Database Licence</ExternalLink>.
        </li>
      </ul>
      <p className="data-sources-note">
        This app processes and combines these datasets (for example, sampling each suburb's area to count nearby bus routes). Its figures are estimates, and none of the organisations above endorses it.
      </p>
    </footer>
  );
}

export default DataSources;
