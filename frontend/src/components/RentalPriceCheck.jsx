import { useEffect, useState } from 'react';
import { getSuburbs, getRentalPriceCheck } from '../api';
import RentalPriceCheckForm from './RentalPriceCheckForm';
import RentalPriceCheckResult from './RentalPriceCheckResult';

const INITIAL_VALUES = {
  sa2_code: '',
  dwelling_type: 'ALL',
  number_of_beds: '',
  rent: '',
};

function RentalPriceCheck() {
  const [suburbs, setSuburbs] = useState(null);
  const [suburbsError, setSuburbsError] = useState(null);

  const [values, setValues] = useState(INITIAL_VALUES);
  const [status, setStatus] = useState('idle'); // idle | loading | error | success
  const [result, setResult] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);

  useEffect(() => {
    getSuburbs()
      .then(setSuburbs)
      .catch((err) => setSuburbsError(err.message));
  }, []);

  async function handleSubmit() {
    setStatus('loading');
    setErrorMessage(null);
    try {
      const data = await getRentalPriceCheck(values);
      setResult(data);
      setStatus('success');
    } catch (err) {
      setErrorMessage(err.message);
      setStatus('error');
    }
  }

  return (
    <section className="rental-price-check">
      <h1>Rental Price Check</h1>
      <p className="lede">
        Look up the market rent for a suburb, dwelling type and bed count, and
        optionally compare it against a rent you've been quoted.
      </p>

      <div className="rental-price-check-layout">
        <RentalPriceCheckForm
          suburbs={suburbs}
          suburbsError={suburbsError}
          values={values}
          onChange={setValues}
          onSubmit={handleSubmit}
          submitting={status === 'loading'}
        />
        <RentalPriceCheckResult status={status} data={result} errorMessage={errorMessage} />
      </div>
    </section>
  );
}

export default RentalPriceCheck;
