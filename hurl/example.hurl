# API flow: read a user, then list that user's posts. JSONPlaceholder is a
# public fake API, the same one the Playwright example uses.
GET https://jsonplaceholder.typicode.com/users/1
Accept: application/json
HTTP 200
[Captures]
user_id: jsonpath "$.id"
[Asserts]
jsonpath "$.username" exists

GET https://jsonplaceholder.typicode.com/posts?userId={{user_id}}
Accept: application/json
HTTP 200
[Asserts]
jsonpath "$" count > 0
jsonpath "$[*].userId" contains {{user_id}}
