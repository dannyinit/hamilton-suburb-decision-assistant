import { useState } from 'react';
import { getSuburbFinder } from '../api';
import SuburbFinderForm from './SuburbFinderForm';
import SuburbFinderResults from './SuburbFinderResults';

const INITIAL_VALUES = {
  budget: '',
  destination: '',
};

function SuburbFinder() {
  const [values, setValues] = useState(INITIAL_VALUES);
  const [status, setStatus] = useState('idle'); // idle | loading | error | success
  const [result, setResult] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);

  async function handleSubmit() {
    setStatus('loading');
    setErrorMessage(null);
    try {
      // No weight params yet — omitted entirely, so the backend defaults
      // to equal weighting. Adjustable sliders are next step's work.
      const data = await getSuburbFinder(values);
      setResult(data);
      setStatus('success');
    } catch (err) {
      setErrorMessage(err.message);
      setStatus('error');
    }
  }

  return (
    <section className="suburb-finder">
      <h1>Suburb Finder</h1>
      <p className="lede">
        Enter your weekly budget and, optionally, a destination you'd like to be
        close to. Suburbs are ranked by rent, public transport access, and
        distance — weighted equally for now.
      </p>

      <div className="feature-layout">
        <SuburbFinderForm
          values={values}
          onChange={setValues}
          onSubmit={handleSubmit}
          submitting={status === 'loading'}
        />
        <SuburbFinderResults status={status} data={result} errorMessage={errorMessage} />
      </div>
    </section>
  );
}

export default SuburbFinder;
