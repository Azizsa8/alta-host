import { useEffect, useState } from "react";
import { api, type Guest } from "../api/client.js";

export function Guests({ propertyId, refreshKey }: { propertyId: string; refreshKey: number }) {
  const [guests, setGuests] = useState<Guest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api
      .guests(propertyId)
      .then(setGuests)
      .finally(() => setLoading(false));
  }, [propertyId, refreshKey]);

  return (
    <div>
      <h1>Guests</h1>
      <p className="sub">Unified guest profile — reservation and conversation history in one place.</p>

      {loading ? (
        <p className="empty">Loading…</p>
      ) : guests.length === 0 ? (
        <p className="empty">No guests yet — send a message from the Simulator to create one.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Guest</th>
              <th>WhatsApp</th>
              <th>Room</th>
              <th>Last message</th>
            </tr>
          </thead>
          <tbody>
            {guests.map((g) => {
              const lastMsg = g.conversations[0]?.messages[0];
              const reservation = g.reservations[0];
              return (
                <tr key={g.id}>
                  <td>
                    <b>{g.name ?? "—"}</b>
                  </td>
                  <td className="mono">{g.whatsappId}</td>
                  <td>{reservation ? `${reservation.roomNumber} (${reservation.status})` : "—"}</td>
                  <td>{lastMsg ? lastMsg.rawText : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
