import "./dom-polyfill";
import "./styles.css";
import { loadBooks } from "./notes";
import { mountWebView } from "./view-web";

const app = document.getElementById("app");
if (!app) throw new Error("#app not found");

const books = loadBooks();
mountWebView({ books, mount: app });
