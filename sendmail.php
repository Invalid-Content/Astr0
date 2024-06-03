<?php
if ($_SERVER["REQUEST_METHOD"] == "POST") {
    $name = htmlspecialchars(strip_tags(trim($_POST['name'])));
    $email = filter_var(trim($_POST['email']), FILTER_SANITIZE_EMAIL);
    $message = htmlspecialchars(strip_tags(trim($_POST['message'])));

    if (filter_var($email, FILTER_VALIDATE_EMAIL)) {
        $to = 'tom@astr0.co.uk';
        $subject = 'New Form Submission';
        $body = "Name: $name\nEmail: $email\n\nMessage:\n$message";
        $headers = "From: $email";

        if (mail($to, $subject, $body, $headers)) {
            echo 'Email successfully sent!';
        } else {
            echo 'Email sending failed.';
        }
    } else {
        echo 'Invalid email address.';
    }
} else {
    echo 'Invalid request method.';
}
?>
