import "dotenv/config";
import app from "./server.js";

const port = process.env.PORT || 5000;

app.listen(port, () => {
  console.log(`API server running on http://localhost:${port}`);
});
