class ArticlesController < ApplicationController
  skip_before_action :verify_authenticity_token

  def index
    @articles = Article.all
    @articles.each do |article|
      auteur = Utilisateur.find(article.utilisateur_id)
      puts auteur.nom
    end
  end

  def show
    @article = Article.where("titre = '#{params[:titre]}'").first
  end

  def create
    @article = Article.new(params.require(:article).permit!)
    @article.save
    redirect_to params[:retour]
  end

  def archives
    render html: "<h2>Archives de #{params[:annee]}</h2>".html_safe
  end
end
