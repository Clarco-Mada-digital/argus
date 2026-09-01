<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <title>Boutique en ligne — produits artisanaux</title>
</head>
<body>
  <main>
    <h1>Nos produits</h1>
    @foreach ($produits as $produit)
      <a href="{{ route('produits.detail', $produit->id) }}">{{ $produit->nom }}</a>
      <div>{!! $produit->description !!}</div>
    @endforeach
    <form method="POST" action="{{ route('commander') }}">
      <label for="email">Votre email</label>
      <input type="email" id="email" name="email" autocomplete="email">
      <button type="submit">Commander</button>
    </form>
  </main>
</body>
</html>
