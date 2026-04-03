interface TrackedOrder {
  id: string;
  retailer: string;
  description: string;
  trackingNumber: string | null;
  carrier: string | null;
  status: "ordered" | "shipped" | "out_for_delivery" | "delivered";
  orderDate: string;
  estimatedDelivery: string | null;
  imageUrl: string | null;
}

interface Props {
  orders: TrackedOrder[];
}

function statusBadge(status: TrackedOrder["status"]) {
  switch (status) {
    case "out_for_delivery": return { cls: "badge-green", label: "Out for Delivery" };
    case "shipped": return { cls: "badge-yellow", label: "Shipped" };
    case "ordered": return { cls: "badge-muted", label: "Ordered" };
    case "delivered": return { cls: "badge-green", label: "Delivered" };
  }
}

function formatDelivery(est: string | null): string {
  if (!est) return "";
  const d = new Date(est + "T12:00:00");
  if (isNaN(d.getTime())) return est;
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === tomorrow.toDateString()) return "Tomorrow";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export function PackagesCard({ orders }: Props) {
  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Packages</span>
        <span className="card-badge badge-muted">
          {orders.length} active
        </span>
      </div>

      {orders.length === 0 ? (
        <div className="empty-state">No active deliveries</div>
      ) : (
        orders.slice(0, 10).map((order) => {
          const badge = statusBadge(order.status);
          const delivery = formatDelivery(order.estimatedDelivery);
          return (
            <div key={order.id} className="list-item">
              {order.imageUrl ? (
                <img
                  src={order.imageUrl}
                  alt=""
                  className="list-item-thumb"
                  loading="lazy"
                />
              ) : (
                <div className="list-item-thumb list-item-thumb-placeholder">
                  {order.retailer.charAt(0)}
                </div>
              )}
              <div className="list-item-text">
                <div className="list-item-title">{order.description}</div>
                <div className="list-item-sub">
                  {order.retailer}
                  {order.carrier && order.carrier !== order.retailer && ` via ${order.carrier}`}
                  {delivery && ` — ${delivery}`}
                </div>
              </div>
              <span className={`card-badge ${badge.cls}`} style={{ flexShrink: 0 }}>
                {badge.label}
              </span>
            </div>
          );
        })
      )}
    </div>
  );
}
