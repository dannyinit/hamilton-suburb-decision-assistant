// Static overview of the app: what it's for, how to use each feature, and
// which datasets it draws on. Deliberately no API calls — nothing here
// depends on the current data pull. Full attribution and licences stay in
// the DataSources footer (rendered by the App layout on every page, this one
// included), so the "Data used" list below is a plain-language summary, not
// a second copy of the licence text to keep in sync.
//
// Like the two feature pages, the page title is an <h2> under the app's
// single <h1>, with <h3>/<h4> for the sections inside it.
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

        <h3>How to use it</h3>
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

        <h3>Data used</h3>
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
        <p className="about-note">
          All figures are estimates based on this data, not financial or
          housing advice. Full attribution and licences are listed at the
          bottom of every page.
        </p>
      </div>
    </section>
  );
}

export default About;
