import { createSocket } from "dgram";
import { networkInterfaces } from "os";

const SSDP_ADDR = "239.255.255.250";
const SSDP_PORT = 1900;
const ALIVE_INTERVAL_MS = 5 * 60 * 1000;

// Services to advertise — each needs a LOCATION url and DEVICE_ID
// Format: DEVICE_ID=id,LOCATION=url;DEVICE_ID=id2,LOCATION=url2
// Or via individual env vars for a single device
const DEVICE_ID = process.env.DEVICE_ID || "MAISIE01";
const LOCATION = process.env.LOCATION || "http://localhost:5004/discover.json";

function getLocalIp(): string {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return "127.0.0.1";
}

const USN = `uuid:${DEVICE_ID}::upnp:rootdevice`;

function buildNotify(nt: string): string {
  return [
    "NOTIFY * HTTP/1.1",
    `HOST: ${SSDP_ADDR}:${SSDP_PORT}`,
    `CACHE-CONTROL: max-age=1800`,
    `NT: ${nt}`,
    `NTS: ssdp:alive`,
    `USN: ${USN}`,
    `LOCATION: ${LOCATION}`,
    `SERVER: Maisie/1.0 UPnP/1.0`,
    "",
    "",
  ].join("\r\n");
}

function buildResponse(st: string): string {
  return [
    "HTTP/1.1 200 OK",
    `CACHE-CONTROL: max-age=1800`,
    `ST: ${st}`,
    `USN: ${USN}`,
    `LOCATION: ${LOCATION}`,
    `SERVER: Maisie/1.0 UPnP/1.0`,
    "",
    "",
  ].join("\r\n");
}

const socket = createSocket({ type: "udp4", reuseAddr: true });

socket.on("error", (err) => {
  console.error("[ssdp] Error:", err.message);
});

socket.bind(SSDP_PORT, () => {
  socket.addMembership(SSDP_ADDR);

  const localIp = getLocalIp();
  console.log(`📡 SSDP advertiser started`);
  console.log(`   Local IP: ${localIp}`);
  console.log(`   Device: ${DEVICE_ID}`);
  console.log(`   Location: ${LOCATION}`);

  sendAlive();
  setInterval(sendAlive, ALIVE_INTERVAL_MS);
});

// Respond to M-SEARCH
socket.on("message", (msg, rinfo) => {
  const message = msg.toString();
  if (!message.includes("M-SEARCH")) return;

  if (
    message.includes("ssdp:all") ||
    message.includes("upnp:rootdevice") ||
    message.includes("urn:schemas-upnp-org:device:MediaServer:1")
  ) {
    const response = Buffer.from(buildResponse("upnp:rootdevice"));
    socket.send(response, 0, response.length, rinfo.port, rinfo.address);
  }
});

function sendAlive() {
  const notify = Buffer.from(buildNotify("upnp:rootdevice"));
  socket.send(notify, 0, notify.length, SSDP_PORT, SSDP_ADDR);
}
