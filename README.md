# 🍔 FlowOps - Restaurant Operations Management

![React](https://img.shields.io/badge/react-%2320232a.svg?style=for-the-badge&logo=react&logoColor=%2361DAFB)
![TypeScript](https://img.shields.io/badge/typescript-%23007ACC.svg?style=for-the-badge&logo=typescript&logoColor=white)
![NodeJS](https://img.shields.io/badge/node.js-6DA55F?style=for-the-badge&logo=node.js&logoColor=white)
![Express.js](https://img.shields.io/badge/express.js-%23404d59.svg?style=for-the-badge&logo=express&logoColor=%2361DAFB)
![PostgreSQL](https://img.shields.io/badge/postgresql-4169e1?style=for-the-badge&logo=postgresql&logoColor=white)
![TailwindCSS](https://img.shields.io/badge/tailwindcss-%2338B2AC.svg?style=for-the-badge&logo=tailwind-css&logoColor=white)

FlowOps es una aplicación Full-Stack diseñada para digitalizar, optimizar y centralizar la gestión operativa de restaurantes universitarios y franquicias.

Este proyecto ha sido desarrollado como Trabajo de Fin de Grado / Ciclo, enfocándose en la escalabilidad, la experiencia de usuario (UX/UI) y la robustez del lado del servidor.

## 🚀 Proyecto en Vivo (Live Demo)

Puedes probar la aplicación funcionando en producción a través del siguiente enlace. El entorno se actualiza automáticamente mediante integración continua (CI/CD).

🔗 **[Visitar FlowOps App](https://flowops-rth4.onrender.com)**

### Credenciales de acceso (Modo Demo):
Para facilitar la evaluación del proyecto, puedes acceder con el siguiente usuario preconfigurado con permisos de Manager para probar todas las funcionalidades:
- **Email:** `demo@flowops.com`
- **Contraseña:** `demo123`
- **Establecimiento:** Bison Den

---

## ✨ Características Principales (Features)

- **🔐 Autenticación y Roles:** Sistema de jerarquía (Admin, Manager, Empleado) con rutas protegidas y control de acceso basado en roles (RBAC).
- **📦 Gestión de Inventario Inteligente:** Control de stock en tiempo real. Al registrar una nueva venta, el sistema **descuenta automáticamente** los ingredientes correspondientes a la receta del plato vendido.
- **🛠️ Mantenimiento de Equipos:** Registro del estado de la maquinaria (fritadoras, neveras, etc.) con alertas visuales de averías.
- **📋 Checklists y Tareas (RPA):** Listas de tareas para apertura, turno y cierre. Las tareas semanales exigen validación fotográfica para ser marcadas como completadas.
- **💬 Chat Interno en Tiempo Real:** Comunicación directa entre la plantilla del establecimiento con soporte para "Quick Actions" (mensajes predefinidos de alerta).
- **📊 Timeline de Eventos:** Auditoría automática de todo lo que ocurre en el sistema (cambios de stock críticos, tareas completadas, altas de usuarios).

---

## 🛠️ Arquitectura y Tecnologías (Tech Stack)

El proyecto sigue una arquitectura Cliente-Servidor separada pero empaquetada en un único repositorio para facilitar el despliegue.

**Frontend:**
- **React 19** + **Vite**: Renderizado ultra rápido.
- **Tailwind CSS** + **shadcn/ui**: Diseño totalmente responsive, accesible (Radix UI) y modo oscuro nativo.
- **Framer Motion**: Animaciones fluidas para mejorar la UX móvil.
- **React Query (@tanstack/react-query)**: Gestión del estado asíncrono y caché de peticiones.
- **Zustand**: Gestión del estado global (sesión de usuario).

**Backend:**
- **Node.js** + **Express**: Servidor API RESTful.
- **TypeScript**: Tipado estático de extremo a extremo (End-to-End type safety) compartiendo esquemas entre cliente y servidor.
- **Zod**: Validación de datos estricta en los endpoints.
- **Multer**: Gestión de subida de archivos (fotografías de tareas y avatares).

**Base de Datos & DevOps:**
- **PostgreSQL** (alojado en Neon Serverless).
- **Drizzle ORM**: Consultas a base de datos eficientes y fuertemente tipadas.
- **Despliegue (Render)**: Pipelines de CI/CD conectados a la rama `main` de GitHub.

---

## Monitoreo de errores (Sentry)

El frontend (`@sentry/react`, proyecto `flowops`) y la API (`@sentry/node`, proyecto `flowops-api`) envían errores y trazas solo si hay un DSN. Si la variable está vacía, Sentry no se inicializa y la app arranca igual.

En el servicio de Render (sin redesplegar hasta que las variables estén puestas):

1. **`SENTRY_DSN`** — DSN de `flowops-api`. La API lo lee al arrancar el proceso (`npm start` ya carga el hook `--import @sentry/node/import`).
2. **`VITE_SENTRY_DSN`** — DSN de `flowops`. Vite lo incrusta en el bundle durante `vite build`. Tiene que existir en el entorno de build. Ponerla solo en runtime no llega al navegador. En Render, una variable del servicio está disponible en el build y en runtime si se define antes del deploy.
3. **`SENTRY_AUTH_TOKEN`** — secreto de build para subir los source maps del frontend a `flowops`. Si falta, `vite build` termina bien y no sube mapas. No va en el repositorio; solo en el entorno de build de Render.

Los DSN y el token van solo en variables de entorno. `.env.example` tiene placeholders falsos.

## 🔒 Seguridad
- Las contraseñas en la base de datos están encriptadas utilizando `bcrypt` (Salt Rounds: 10).
- La gestión de sesiones se realiza a través de cookies `httpOnly` respaldadas por PostgreSQL (`connect-pg-simple`), previniendo ataques XSS.
- Protección en producción con `trust proxy` para proxies inversos.

---
*Desarrollado por Daniel Alarcón.*
