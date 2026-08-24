import VehicleList from './VehicleList';

export default function MobileObjects({ vehicles, stats, openDetail }) {
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <VehicleList vehicles={vehicles} stats={stats} onPick={openDetail} showAddress />
    </div>
  );
}
