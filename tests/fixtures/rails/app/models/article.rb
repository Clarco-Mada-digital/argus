class Article < ApplicationRecord
  has_many :commentaires
  validates :titre, presence: true
end
