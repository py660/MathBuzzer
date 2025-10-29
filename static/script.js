const socket = io(window.location.host, {
  reconnectionDelayMax: 10000,
  auth: {
    code: "123",
    name: "Guest"
  }
});