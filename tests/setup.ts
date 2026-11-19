import { config } from "dotenv";
config({ path: ".env" });
// Usa una base aparte si la defines (recomendado): TEST_DATABASE_URL=mysql://.../concilia_test
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
