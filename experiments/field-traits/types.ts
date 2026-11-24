import { createField as baseline } from "./baseline";
import { createField as candidate } from "./field";

// Check the complete overloaded factory types in both directions, including
// generic values/meta and function/effect validator overloads.
const oldAPI: typeof baseline = candidate;
const newAPI: typeof candidate = baseline;
void oldAPI;
void newAPI;
