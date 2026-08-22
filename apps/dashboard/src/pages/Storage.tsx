import { useCallback, useEffect, useRef, useState } from "react";
import { api, type StorageFile, type StorageQuota } from "../api/client.js";

const KIND_LABELS: Record<string, string> = {
  fault_photo: "صورة عطل",
  content_media: "محتوى تسويقي",
  document: "مستند",
};

function fmtBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.ceil(bytes / 1024)} KB`;
}

/** §5 / §11-8: quota meter with the 80% warning band, plus the file
 *  library with 30-day trash. Uploads go browser→object storage via a
 *  presigned PUT — the file bytes never pass through the API. */
export function Storage({ refreshKey }: { refreshKey: number }) {
  const [quota, setQuota] = useState<StorageQuota | null>(null);
  const [files, setFiles] = useState<StorageFile[]>([]);
  const [tab, setTab] = useState<"active" | "trashed">("active");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(() => {
    api.storageQuota().then(setQuota).catch(() => {});
    api.storageFiles(tab).then(setFiles).catch(() => setFiles([]));
  }, [tab]);

  useEffect(reload, [reload, refreshKey]);

  async function upload(file: File) {
    setBusy(true);
    setError("");
    try {
      const kind = file.type.startsWith("image/") ? "fault_photo" : file.type.startsWith("video/") ? "content_media" : "document";
      const grant = await api.requestUpload({ kind, name: file.name, mime: file.type, sizeBytes: file.size });
      const put = await fetch(grant.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!put.ok) throw new Error(`فشل الرفع إلى التخزين (${put.status})`);
      await api.confirmUpload(grant.fileId);
      reload();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("507")) setError("المساحة ممتلئة — قم بترقية الباقة أو أفرغ سلة المحذوفات.");
      else if (msg.includes("415")) setError("نوع الملف غير مسموح (صور، فيديو MP4، أو PDF فقط).");
      else if (msg.includes("413")) setError("حجم الملف يتجاوز الحد المسموح لنوعه.");
      else setError(msg);
    } finally {
      setBusy(false);
    }
  }

  async function download(id: string) {
    const { url } = await api.fileUrl(id);
    window.open(url, "_blank", "noopener");
  }

  const usedPct = quota?.usedPct ?? 0;
  const barColor = usedPct >= 100 ? "bg-gradient-danger" : usedPct >= 80 ? "bg-gradient-warning" : "bg-gradient-success";

  return (
    <div className="row">
      <div className="col-12 mb-4">
        <div className="card">
          <div className="card-header pb-0 d-flex justify-content-between align-items-center">
            <div>
              <h6>مساحة التخزين</h6>
              <p className="text-sm mb-0">
                {quota
                  ? `${fmtBytes(Number(quota.usedBytes))} من ${quota.quotaGb} GB (${usedPct}%)`
                  : "جارٍ التحميل…"}
              </p>
            </div>
            {usedPct >= 80 && (
              <span className={`badge badge-sm ${usedPct >= 100 ? "bg-gradient-danger" : "bg-gradient-warning"}`}>
                {usedPct >= 100 ? "المساحة ممتلئة" : "اقتربت من الحد"}
              </span>
            )}
          </div>
          <div className="card-body pt-2">
            <div className="progress" style={{ height: 10 }}>
              <div
                className={`progress-bar ${barColor}`}
                role="progressbar"
                style={{ width: `${Math.min(usedPct, 100)}%` }}
                aria-valuenow={usedPct}
                aria-valuemin={0}
                aria-valuemax={100}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="col-12">
        <div className="card">
          <div className="card-header pb-0 d-flex justify-content-between align-items-center">
            <div className="d-flex gap-3 align-items-center">
              <h6 className="mb-0">الملفات</h6>
              <ul className="nav nav-pills nav-sm">
                <li className="nav-item">
                  <button className={`nav-link py-1 px-3 ${tab === "active" ? "active" : ""}`} onClick={() => setTab("active")}>
                    النشطة
                  </button>
                </li>
                <li className="nav-item">
                  <button className={`nav-link py-1 px-3 ${tab === "trashed" ? "active" : ""}`} onClick={() => setTab("trashed")}>
                    سلة المحذوفات (٣٠ يوماً)
                  </button>
                </li>
              </ul>
            </div>
            <div>
              <input
                ref={inputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,video/mp4,application/pdf"
                className="d-none"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void upload(f);
                  e.target.value = "";
                }}
              />
              <button className="btn btn-sm bg-gradient-primary mb-0" disabled={busy} onClick={() => inputRef.current?.click()}>
                {busy ? "جارٍ الرفع…" : "رفع ملف"}
              </button>
            </div>
          </div>
          <div className="card-body px-0 pb-2">
            {error && <p className="text-sm text-danger px-4">{error}</p>}
            {files.length === 0 ? (
              <p className="text-sm text-secondary px-4 mb-3">
                {tab === "active" ? "لا توجد ملفات بعد." : "سلة المحذوفات فارغة."}
              </p>
            ) : (
              <div className="table-responsive">
                <table className="table align-items-center mb-0">
                  <thead>
                    <tr>
                      <th className="text-uppercase text-secondary text-xxs font-weight-bolder opacity-7">الملف</th>
                      <th className="text-uppercase text-secondary text-xxs font-weight-bolder opacity-7">النوع</th>
                      <th className="text-uppercase text-secondary text-xxs font-weight-bolder opacity-7">الحجم</th>
                      <th className="text-uppercase text-secondary text-xxs font-weight-bolder opacity-7">التاريخ</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {files.map((f) => (
                      <tr key={f.id}>
                        <td className="ps-4">
                          <span className="text-sm font-weight-bold">{f.name}</span>
                        </td>
                        <td>
                          <span className="badge badge-sm bg-gradient-secondary">{KIND_LABELS[f.kind] ?? f.kind}</span>
                        </td>
                        <td className="text-sm">{fmtBytes(Number(f.sizeBytes))}</td>
                        <td className="text-sm">{new Date(f.createdAt).toLocaleDateString("ar-SA")}</td>
                        <td className="text-start pe-4">
                          {tab === "active" ? (
                            <>
                              <button className="btn btn-link text-primary text-sm mb-0 py-0" onClick={() => void download(f.id)}>
                                تنزيل
                              </button>
                              <button
                                className="btn btn-link text-danger text-sm mb-0 py-0"
                                onClick={() => api.trashFile(f.id).then(reload)}
                              >
                                حذف
                              </button>
                            </>
                          ) : (
                            <button
                              className="btn btn-link text-primary text-sm mb-0 py-0"
                              onClick={() => api.restoreFile(f.id).then(reload)}
                            >
                              استعادة
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
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
