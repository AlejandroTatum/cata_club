const CREDENTIALS = [
  "Campeones provinciales de Loja",
  "Representación nacional",
  "Sudamericano Sub-11 y Sub-13",
  "Formando campeones desde 2013",
];

function TickerCopy(): React.ReactElement {
  return (
    <>
      {CREDENTIALS.map((credential): React.ReactElement => (
        <span className="landing-ticker-item" key={credential}>
          <b aria-hidden="true">✦</b>
          {credential}
        </span>
      ))}
    </>
  );
}

export default function Ticker(): React.ReactElement {
  return (
    <section className="landing-credentials-ticker" aria-label="Credenciales deportivas">
      <div className="landing-ticker-viewport">
        <div className="landing-ticker-track" data-credentials-ticker>
          <div className="landing-ticker-copy"><TickerCopy /></div>
          <div className="landing-ticker-copy" aria-hidden="true"><TickerCopy /></div>
        </div>
      </div>
    </section>
  );
}
