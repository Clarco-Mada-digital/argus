Rails.application.routes.draw do
  root 'articles#index'
  get 'articles', to: 'articles#index'
  get 'articles/:id', to: 'articles#show'
  post 'commentaires', to: 'commentaires#create'
  get 'Archives', to: 'articles#archives'
end
