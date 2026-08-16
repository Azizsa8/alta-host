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
    <div className="row">
      <div className="col-12">
        <div className="card">
          <div className="card-header pb-0">
            <h6>النزلاء</h6>
            <p className="text-sm mb-0">ملف موحّد للنزيل — سجل الحجز والمحادثة في مكان واحد.</p>
          </div>
          <div className="card-body px-0 pb-2">
            {loading ? (
              <p className="text-sm text-secondary px-4">جارٍ التحميل…</p>
            ) : guests.length === 0 ? (
              <p className="text-sm text-secondary px-4">لا يوجد نزلاء بعد — أرسل رسالة من المحاكي لإنشاء نزيل.</p>
            ) : (
              <div className="table-responsive">
                <table className="table align-items-center mb-0">
                  <thead>
                    <tr>
                      <th className="text-uppercase text-secondary text-xxs font-weight-bolder opacity-7">النزيل</th>
                      <th className="text-uppercase text-secondary text-xxs font-weight-bolder opacity-7 ps-2">واتساب</th>
                      <th className="text-uppercase text-secondary text-xxs font-weight-bolder opacity-7">الغرفة</th>
                      <th className="text-uppercase text-secondary text-xxs font-weight-bolder opacity-7">آخر رسالة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {guests.map((g) => {
                      const lastMsg = g.conversations[0]?.messages[0];
                      const reservation = g.reservations[0];
                      return (
                        <tr key={g.id}>
                          <td>
                            <p className="text-sm font-weight-bold mb-0 px-2">{g.name ?? "—"}</p>
                          </td>
                          <td>
                            <p className="text-sm mono mb-0">{g.whatsappId}</p>
                          </td>
                          <td>
                            <p className="text-sm mb-0">{reservation ? `${reservation.roomNumber} (${reservation.status})` : "—"}</p>
                          </td>
                          <td>
                            <p className="text-sm text-secondary mb-0">{lastMsg ? lastMsg.rawText : "—"}</p>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
