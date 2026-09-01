export default defineEventHandler(async (event) => {
  const corps = await readBody(event)
  const cle = process.env.NUXT_PUBLIC_API_SECRET
  return { recu: corps, cle }
})
