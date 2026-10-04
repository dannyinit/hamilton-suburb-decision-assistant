// Static overview of the app: what it's for, how to use each feature, how
// results are calculated, and which datasets it draws on. The calculation
// section reuses the Suburb Finder legend's wording (SuburbFinderResults.jsx)
// so the two stay consistent; keep them in step when either changes. Deliberately no API calls — nothing here
// depends on the current data pull. Full attribution and licences stay in
// the DataSources footer (rendered by the App layout on every page, this one
// included), so the "Data used" list below is a plain-language summary, not
// a second copy of the licence text to keep in sync.
//
// Like the two feature pages, the page title is an <h2> under the app's
// single <h1>, with <h3>/<h4> for the sections inside it.
//
// The first two sections are always visible; the longer reference sections
// are native <details>, closed by default, so the page is short to take in
// (usability feedback) without JavaScript: mouse, touch, Enter and Space all
// toggle them, and screen readers announce expanded/collapsed. Each <h3>
// sits inside its <summary> (allowed by the HTML spec), so the heading
// outline is kept. The estimates disclaimer is part of "What this app
// does", so it is always visible.
function AboutSection({ title, children }) {
  return (
    <details className="about-section">
      <summary>
        <h3>{title}</h3>
        <span className="about-section-chevron" aria-hidden="true">▸</span>
      </summary>
      <div className="about-section-body">{children}</div>
    </details>
  );
}

function About() {
  return (
    <section className="about">
      <h2>About</h2>
      <p className="about-author">Created by Danny Pham</p>

      <div className="about-card">
        <h3>What this app does</h3>
        <p>
          Hamilton Suburb Decision Assistant helps people decide where to rent
          in Hamilton. Instead of checking rent prices, bus access and travel
          distance separately, it brings them together in one place, ranks
          suburbs based on what matters most to you, and explains why each
          suburb was recommended or left out.
        </p>
        <p>
          All figures are estimates based on public data. Use them as a
          starting point for your search, not as financial or housing advice.
        </p>

        <h3>Features</h3>
        <ul>
          <li>
            <strong>Suburb Finder:</strong> ranks Hamilton suburbs based on
            your weekly budget, public transport access and, optionally,
            distance to a destination of your choice.
          </li>
          <li>
            <strong>Rental Price Check:</strong> shows the typical rent for a
            suburb, dwelling type and number of bedrooms, and tells you
            whether a specific rent is below market, fair or above market. It
            also lists the rent for every dwelling type and number of
            bedrooms with data in that suburb.
          </li>
        </ul>

        <AboutSection title="How to use it">
          <h4>Suburb Finder</h4>
          <ol>
            <li>Enter your weekly budget.</li>
            <li>
              Optionally choose a destination: University of Waikato, Transport
              Centre, The Base or Waikato Hospital.
            </li>
            <li>
              Adjust the sliders to set how much rent, transport and distance
              matter to you. The distance slider is available once you choose a
              destination.
            </li>
            <li>
              Click "Find suburbs". With "Live ranking" on, the results update
              as you move the sliders or change the destination.
            </li>
            <li>
              Open any suburb to see how it scored on each criterion, or follow
              its link to check its rent in Rental Price Check. The excluded
              list explains why other suburbs were left out.
            </li>
          </ol>

          <h4>Rental Price Check</h4>
          <ol>
            <li>
              Choose a suburb, and optionally a dwelling type and number of
              bedrooms.
            </li>
            <li>Optionally enter a weekly rent to compare it with the market.</li>
            <li>
              Click "Check rental price" to see the median rent, the typical
              price range and a breakdown by dwelling type and number of
              bedrooms.
            </li>
          </ol>
        </AboutSection>

        <AboutSection title="How results are calculated">
          <h4>Suburb Finder</h4>
          <p>
            A suburb is only included if its cheapest option is at or below
            your budget. The cheapest option is the lowest median rent for any
            dwelling type and number of bedrooms in that suburb, using data
            from within a year of the latest quarter.
          </p>
          <p>Suburbs are scored and ranked on the following criteria:</p>
          <ul>
            <li>
              <strong>Rent:</strong> the suburb's median weekly rent across all
              dwelling types. Lower rent scores higher.
            </li>
            <li>
              <strong>Transport:</strong> the average number of bus routes
              with a stop within 400 m, measured at points spread across the
              suburb. More routes score higher, though each extra route adds a
              little less.
            </li>
            <li>
              <strong>Distance:</strong> straight-line distance from the
              suburb's centre to your chosen destination. Shorter distances
              score higher. Only used once you pick a destination.
            </li>
          </ul>
          <p>
            Each criterion is scored from 0 to 1 compared with the other suburbs
            in your results, and the overall score combines them using your
            priorities.
          </p>

          <h4>Rental Price Check</h4>
          <p>
            If you enter a rent you've been quoted, it's compared with the
            typical range shown: from the lower to the upper quartile, which
            covers the middle half of rents. Below the lower quartile is{' '}
            <strong>Below market</strong>, above the upper quartile is{' '}
            <strong>Above market</strong>, and anything in between, including
            either quartile exactly, is <strong>Fair</strong>. If there isn't
            enough data for the exact dwelling type and number of bedrooms, the
            comparison uses the broader estimate shown in the result.
          </p>
        </AboutSection>

        <AboutSection title="Data used">
          <ul>
            <li>
              <strong>Rental prices:</strong> rental bond data from the Ministry
              of Business, Innovation and Employment (MBIE).
            </li>
            <li>
              <strong>Suburb boundaries and centres:</strong> Statistical Area 2
              (2019) data from Stats NZ. The "suburbs" in this app are these
              statistical areas, so some names and boundaries differ from
              everyday suburb names.
            </li>
            <li>
              <strong>Bus stops:</strong> Waikato Regional Council.
            </li>
            <li>
              <strong>Hamilton Lake outline:</strong> OpenStreetMap contributors.
            </li>
          </ul>
          <p>Full attribution and licences are listed at the bottom of every page.</p>
        </AboutSection>
      </div>
    </section>
  );
}

export default About;
