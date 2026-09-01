<template>
  <main>
    <h1>Nos produits</h1>
    <div v-for="p in produits" :key="p.id">
      <NuxtLink :to="`/produits/${p.id}`">{{ p.nom }}</NuxtLink>
      <div v-html="p.description"></div>
    </div>
    <form method="post">
      <input type="email" name="email" placeholder="Votre email">
      <button>Envoyer</button>
    </form>
  </main>
</template>

<script setup>
const config = useRuntimeConfig()
const { data: produits } = await useFetch(`${config.public.apiBase}/produits`)
</script>
