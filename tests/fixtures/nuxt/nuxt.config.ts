export default defineNuxtConfig({
  ssr: false,
  runtimeConfig: {
    public: {
      apiBase: 'https://api.exemple.com',
      stripeSecretKey: process.env.STRIPE_SECRET,
    },
  },
  devtools: { enabled: true },
})
