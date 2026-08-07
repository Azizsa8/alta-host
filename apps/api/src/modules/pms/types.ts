// The one contract every agent talks to instead of calling a PMS vendor
// directly. Real vendor adapters (Oracle OPERA, Mews) implement this same
// interface — swapping PMS_PROVIDER is the only thing that changes.

export interface AvailabilityResult {
  available: boolean;
  roomNumber?: string;
}

export interface BillingStatus {
  hasValidPaymentMethod: boolean;
  outstandingBalance: number;
}

export interface ReservationUpdateResult {
  success: boolean;
  reservationId: string;
  newCheckOut?: string;
}

export interface PMSAdapter {
  getAvailability(propertyId: string, roomNumber: string): Promise<AvailabilityResult>;
  getBillingStatus(guestId: string): Promise<BillingStatus>;
  extendCheckout(reservationId: string, extraHours: number): Promise<ReservationUpdateResult>;
  getReservationForGuest(guestId: string): Promise<{ id: string; roomNumber: string; checkOut: string } | null>;
}
