import { useState, useEffect } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBox, faTruckFast, faBoxOpen, faCircleCheck } from "@fortawesome/free-solid-svg-icons";

interface TrackedOrder {
  id: string;
  retailer: string;
  description: string;
  trackingNumber: string | null;
  carrier: string | null;
  status: "ordered" | "shipped" | "out_for_delivery" | "delivered";
  orderDate: string;
  estimatedDelivery: string | null;
}

const STATUS_CONFIG = {
  out_for_delivery: { icon: faTruckFast, label: "Out for Delivery", color: "rgba(76,217,100,0.9)" },
  shipped: { icon: faBox, label: "Shipped", color: "rgba(255,204,0,0.85)" },
  ordered: { icon: faBoxOpen, label: "Ordered", color: "rgba(255,255,255,0.5)" },
  delivered: { icon: faCircleCheck, label: "Delivered", color: "rgba(255,255,255,0.35)" },
};

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

export function PackagesWidget() {
  const [orders, setOrders] = useState<TrackedOrder[]>([]);

  useEffect(() => {
    const fetchOrders = async () => {
      try {
        const res = await fetch("/api/packages/active");
        if (res.ok) {
          const data = await res.json();
          setOrders(data.orders || []);
        }
      } catch (err) {
        console.error("Failed to fetch packages:", err);
      }
    };
    fetchOrders();
    const interval = setInterval(fetchOrders, 15 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  if (orders.length === 0) {
    return (
      <div style={styles.container}>
        <div style={styles.header}>Packages</div>
        <div style={styles.empty}>No active deliveries</div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        Packages
        <span style={styles.count}>{orders.length}</span>
      </div>
      <div style={styles.list}>
        {orders.map((order) => {
          const config = STATUS_CONFIG[order.status];
          const delivery = formatDelivery(order.estimatedDelivery);
          return (
            <div key={order.id} style={styles.item}>
              <div style={{ ...styles.statusIcon, color: config.color }}>
                <FontAwesomeIcon icon={config.icon} />
              </div>
              <div style={styles.details}>
                <div style={styles.topRow}>
                  <div style={styles.description}>{order.description}</div>
                  {delivery && <div style={styles.delivery}>{delivery}</div>}
                </div>
                <div style={styles.bottomRow}>
                  <span style={styles.retailer}>{order.retailer}</span>
                  {order.carrier && order.carrier !== order.retailer && (
                    <span style={styles.carrier}>via {order.carrier}</span>
                  )}
                  <span style={{ ...styles.statusLabel, color: config.color }}>
                    {config.label}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    color: "white",
    padding: "40px 48px",
    height: "100vh",
    boxSizing: "border-box",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    gap: "24px",
    background: "rgba(30,30,30,0.20)",
    borderRadius: "6px",
  },
  header: {
    fontSize: "36px",
    fontWeight: 700,
    letterSpacing: "-0.3px",
    textShadow: "0 2px 6px rgba(0,0,0,0.7)",
    display: "flex",
    alignItems: "center",
    gap: "14px",
  },
  count: {
    fontSize: "18px",
    fontWeight: 600,
    background: "rgba(255,255,255,0.15)",
    padding: "2px 10px",
    borderRadius: "10px",
  },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
    overflow: "hidden",
  },
  item: {
    display: "flex",
    gap: "16px",
    alignItems: "flex-start",
  },
  statusIcon: {
    fontSize: "22px",
    flexShrink: 0,
    marginTop: "2px",
    textShadow: "0 2px 4px rgba(0,0,0,0.5)",
  },
  details: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },
  topRow: {
    display: "flex",
    alignItems: "baseline",
    gap: "12px",
  },
  description: {
    fontSize: "22px",
    fontWeight: 500,
    textShadow: "0 2px 4px rgba(0,0,0,0.5)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    flex: 1,
  },
  delivery: {
    fontSize: "18px",
    fontWeight: 600,
    color: "rgba(255,255,255,0.7)",
    textShadow: "0 1px 3px rgba(0,0,0,0.5)",
    whiteSpace: "nowrap",
    flexShrink: 0,
  },
  bottomRow: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    fontSize: "14px",
  },
  retailer: {
    fontWeight: 600,
    color: "rgba(255,255,255,0.5)",
    textShadow: "0 1px 2px rgba(0,0,0,0.4)",
  },
  carrier: {
    fontWeight: 500,
    color: "rgba(255,255,255,0.35)",
  },
  statusLabel: {
    fontWeight: 600,
    fontSize: "12px",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
  },
  empty: {
    fontSize: "24px",
    color: "rgba(255,255,255,0.4)",
    fontStyle: "italic",
  },
};
