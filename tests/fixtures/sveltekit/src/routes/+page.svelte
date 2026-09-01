<script>
  import { PUBLIC_API_TOKEN } from '$env/static/public';
  export let data;
</script>

<main>
  <h1>Articles</h1>
  <p>Source : {PUBLIC_API_TOKEN}</p>
  {#each data.articles as article}
    <a href="/articles/{article.slug}">{article.titre}</a>
    {@html article.contenu}
  {/each}
</main>
