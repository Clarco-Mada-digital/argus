import Foundation

final class Reseau: NSObject, URLSessionDelegate {
    func urlSession(
        _ session: URLSession,
        didReceive challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        let identifiant = URLCredential(trust: challenge.protectionSpace.serverTrust!)
        completionHandler(.useCredential, identifiant)
    }
}
