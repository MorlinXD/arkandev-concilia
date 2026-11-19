/** @type {import("next").NextConfig} */
export default {
  // Librerías de correo y base de datos: se cargan desde node_modules en el servidor (no se empaquetan)
  serverExternalPackages: ["mailauth", "imapflow", "mysql2", "postal-mime"],
};
